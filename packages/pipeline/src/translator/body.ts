import type { Article } from "@curation-fyi/shared";

/**
 * リンク先の本文を取得して要約の材料にする。
 *
 * HN はリンク集で、Algolia の API は本文を返さない（fetchers/hackernews.ts が summary: null を入れる）。
 * 材料が無いとモデルは空サマリを返すので、要約を出すにはリンク先を取りに行くしかない。
 *
 * **取得した本文は保存しない。** LLM への入力としてのみ使い、残すのは生成した3行サマリだけ。
 * リポジトリは公開なので、第三者サイトの本文を溜め込まない。
 */

const USER_AGENT = "curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)";
const TIMEOUT_MS = 15_000;
/** 絞り込みの結果がこれ未満なら、ページ構造が想定と違うとみなして素朴な除去に落とす */
const MIN_SCOPED_CHARS = 500;
/** LLM に渡す長さ。これ以上あっても3行サマリには要らない */
const MAX_CHARS = 2_000;
const CONCURRENCY = 8;

/** タグと実体参照を落として本文だけにする */
function clean(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** script/style だけ落として全部拾う。構造が読めないページ向けの最後の手段 */
function naive(html: string): string {
  return clean(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " "));
}

/**
 * 本文らしい領域だけを取る。<article> → <main> → 長めの <p> を連結、の順に試す。
 * 実測では geekdot が 19,938字→5,173字（定型文を75%除去）と効く一方、
 * 構造が違うページでは壊滅する（san.com 10,142字→114字）ため、呼び出し側で長さを見て落とす。
 */
function scoped(html: string): string {
  const noise = html.replace(
    /<(script|style|nav|header|footer|aside|form|svg|noscript)[\s\S]*?<\/\1>/gi,
    " ",
  );
  const region =
    noise.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ?? noise.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (region?.[1]) return clean(region[1]);
  const paragraphs = [...noise.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => clean(m[1] ?? ""))
    .filter((t) => t.length > 60);
  return paragraphs.join(" ");
}

/**
 * JS描画のページが本文の代わりに返す定型文。
 * これを落としてから長さを見ないと、**下限は超えるが中身が無い**テキストが本文として通る。
 * 実測: grapheneos.social（Mastodon）は抽出223字のうち大半がこの文で、
 * 生成されたサマリが「JavaScriptの有効化が必要」という閲覧要件の説明になっていた。
 */
const BOILERPLATE: RegExp[] = [
  /to use the [^.]{0,40}web application,?\s*please enable javascript\.?/gi,
  /please enable javascript[^.]{0,80}\.?/gi,
  /javascript is (?:required|disabled|not enabled)[^.]{0,80}\.?/gi,
  /you need to enable javascript to run this app\.?/gi,
  /(?:your |the )?browser (?:does not support|is not supported|doesn't support)[^.]{0,80}\.?/gi,
  /enable javascript (?:and cookies )?to continue\.?/gi,
  /alternatively,? (?:you can )?(?:try|use|install) (?:one of )?the (?:native |official )?apps?[^.]{0,60}\.?/gi,
];

/** 定型文を落とす。落とした結果が短ければ、呼び出し側の下限で弾かれる */
function stripBoilerplate(text: string): string {
  let out = text;
  for (const re of BOILERPLATE) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").trim();
}

/** HTML から要約の材料になるテキストを取り出す */
export function extractBody(html: string, maxChars = MAX_CHARS): string {
  const picked = scoped(html);
  const text = picked.length >= MIN_SCOPED_CHARS ? picked : naive(html);
  return stripBoilerplate(text).slice(0, maxChars);
}

export interface FetchBodiesStats {
  attempted: number;
  /** 本文が取れた件数 */
  ok: number;
  /** HTML でなかった（PDF・動画など） */
  notHtml: number;
  /** 4xx/5xx。ペイウォールの403を含む */
  httpError: number;
  /** タイムアウト・DNS・接続エラー */
  failed: number;
  /** 取得はできたが本文が短すぎた（JS描画のページなど） */
  tooShort: number;
}

/** 1件取得する。失敗は例外にせず null を返す（取得の失敗が翻訳を止めてはいけない） */
async function fetchOne(url: string, maxChars: number): Promise<{ text: string | null; kind: keyof FetchBodiesStats }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return { text: null, kind: "httpError" };
    const type = ((res.headers.get("content-type") ?? "").split(";")[0] ?? "").trim();
    if (!type.includes("html")) return { text: null, kind: "notHtml" };
    const text = extractBody(await res.text(), maxChars);
    if (text.length < 200) return { text: null, kind: "tooShort" };
    return { text, kind: "ok" };
  } catch {
    return { text: null, kind: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * summary を持たない記事のリンク先をまとめて取得する。
 * 失敗した記事は Map に入らない（呼び出し側では従来どおり「タイトルのみ」として扱われる）。
 */
export async function fetchBodies(
  articles: Article[],
  { concurrency = CONCURRENCY, maxChars = MAX_CHARS } = {},
): Promise<{ bodies: Map<string, string>; stats: FetchBodiesStats }> {
  const targets = articles.filter((a) => !a.summary);
  const bodies = new Map<string, string>();
  const stats: FetchBodiesStats = {
    attempted: targets.length,
    ok: 0,
    notHtml: 0,
    httpError: 0,
    failed: 0,
    tooShort: 0,
  };
  if (targets.length === 0) return { bodies, stats };

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const article = targets[cursor++];
      if (!article) break;
      const { text, kind } = await fetchOne(article.url, maxChars);
      if (text) bodies.set(article.url, text);
      stats[kind]++;
    }
  });
  await Promise.all(workers);

  console.log(
    `本文取得: ${stats.ok}/${stats.attempted} 件（HTMLでない ${stats.notHtml} / ` +
      `HTTPエラー ${stats.httpError} / 取得失敗 ${stats.failed} / 短すぎ ${stats.tooShort}）`,
  );
  return { bodies, stats };
}
