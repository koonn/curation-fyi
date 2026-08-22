import { Type } from "@google/genai";
import type { Article } from "@curation-fyi/shared";
import { BATCH_SIZE, chunk, type LlmRunner, QuotaExceededError } from "../llm/gemini.ts";

/** サマリの行数。カードの表示もこの数を前提にする */
const SUMMARY_LINES = 3;

/** レスポンスの形。記事は index で対応づける（順序ズレ・件数不足で他の記事を巻き込まないため） */
const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      i: { type: Type.INTEGER, description: "記事番号" },
      title_ja: { type: Type.STRING, description: "和訳した見出し" },
      summary_ja: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: `要点を${SUMMARY_LINES}行。情報が足りなければ行を減らすか空にする`,
      },
    },
    required: ["i", "title_ja", "summary_ja"],
  },
};

interface TranslateAnswer {
  i: number;
  title_ja: string;
  summary_ja: string[];
}

function buildPrompt(articles: Article[], bodies: Map<string, string>): string {
  const list = articles
    .map((a, i) => {
      // リンク先の本文が取れていればそれを使う（フィードの要約より情報量が多い）。
      // 取得は「要約が無い or 短すぎる」記事にしか走らないので、優先して問題ない
      const body = bodies.get(a.url);
      const material = body
        ? `\n   本文（抜粋）: ${body}`
        : a.summary
          ? `\n   要約: ${a.summary}`
          : "\n   要約: （フィードに無し。タイトルのみ）";
      return `${i}. タイトル: ${a.title}${material}`;
    })
    .join("\n");
  return `以下は英語の技術記事です。それぞれについて次の2つを日本語で作ってください。
記事番号 i は入力のものをそのまま返し、全 ${articles.length} 件を漏れなく1件ずつ返してください。

1. title_ja: 見出しの和訳。直訳ではなく、日本語の技術記事の見出しとして自然な形にする
2. summary_ja: 内容の要点を${SUMMARY_LINES}行。各行は40字程度の短い文にする

summary_ja の注意:
- **見出しの言い換えを並べない**。見出しから分かること以外の中身を書く
- **与えられた情報に書かれていないことは書かない**。推測で補わない
- タイトルしか無く要点が取れない場合は、無理に${SUMMARY_LINES}行にせず、行を減らすか空配列にする

記事:
${list}`;
}

/** 空白だけの行を落とし、最大 SUMMARY_LINES 行に切る */
function cleanLines(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l): l is string => typeof l === "string")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, SUMMARY_LINES);
}

export interface TranslateResult {
  /** title_ja を書き込んだ記事 */
  updated: Article[];
  processed: number;
  /** processed のうちサマリが SUMMARY_LINES 行に満たなかった件数（タイトルのみの記事で出やすい） */
  shortSummary: number;
  /** processed のうちサマリが空だった件数。「情報が足りない」とモデルが判断したもの */
  emptySummary: number;
  /** やり直しの結果が前回より短かったため、前回を残した件数 */
  kept: number;
  /** レスポンスに現れなかった・見出しが空で捨てた件数。次回実行で再び対象になる */
  missed: number;
  requests: number;
  /** 打ち切った理由（どの上限に当たったか）。打ち切っていなければ null */
  quotaDetail: string | null;
}

/**
 * 英語記事に和訳見出しと3行サマリを付ける。
 * 1リクエストに BATCH_SIZE 件をまとめ、予算（runner）が尽きたら打ち切って正常に返す。
 * title_ja が入った記事は次回の候補から外れる（title_ja の有無が処理済みフラグを兼ねる）。
 */
export async function translateWithLlm(
  candidates: Article[],
  runner: LlmRunner,
  bodies: Map<string, string> = new Map(),
): Promise<TranslateResult> {
  const result: TranslateResult = {
    updated: [],
    processed: 0,
    shortSummary: 0,
    emptySummary: 0,
    kept: 0,
    missed: 0,
    requests: 0,
    quotaDetail: null,
  };
  if (candidates.length === 0) {
    console.log("和訳: 対象記事なし");
    return result;
  }

  for (const batch of chunk(candidates, BATCH_SIZE)) {
    let answers: TranslateAnswer[] | null;
    try {
      answers = await runner.json<TranslateAnswer[]>(buildPrompt(batch, bodies), RESPONSE_SCHEMA);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        result.quotaDetail = e.detail;
        break;
      }
      throw e;
    }
    result.requests++;

    if (!Array.isArray(answers)) {
      // バッチごと落とす。リトライはしない（次回実行で再び対象になる）
      result.missed += batch.length;
      console.error(`✗ 和訳: レスポンスが配列でないためバッチ${batch.length}件をスキップ`);
      continue;
    }

    const applied = new Set<number>();
    for (const answer of answers) {
      const article = batch[answer?.i as number];
      if (!article || applied.has(answer.i)) continue; // 範囲外・重複は無視
      const title = typeof answer.title_ja === "string" ? answer.title_ja.trim() : "";
      // 見出しが空なら書き込まない＝この記事だけ次回に残る（他は巻き込まない）
      if (title === "") continue;
      const lines = cleanLines(answer.summary_ja);
      article.title_ja = title;
      // **やり直しで結果が悪くなることがある**（モデルは非決定的で、同じ入力でも
      // 行数が減ることがある）。前回より行数が少ないなら前回を残す——上書きは
      // 情報が増える方向にだけ動かす。実測: 無条件上書きにしていた実行で、
      // 1〜2行あった記事14件が空で塗り潰された
      const previous = article.summary_ja ?? [];
      if (lines.length >= previous.length) article.summary_ja = lines;
      else result.kept++;
      const applied_lines = article.summary_ja ?? [];
      if (applied_lines.length === 0) result.emptySummary++;
      else if (applied_lines.length < SUMMARY_LINES) result.shortSummary++;
      result.updated.push(article);
      applied.add(answer.i);
    }
    result.processed += applied.size;
    result.missed += batch.length - applied.size;
  }

  const remaining = candidates.length - result.processed - result.missed;
  const { input, output } = runner.tokens;
  const waits = runner.waits;
  console.log(
    `和訳: ${result.processed} 件処理（${result.requests} リクエスト、` +
      `サマリ${SUMMARY_LINES}行未満 ${result.shortSummary} 件、サマリ空 ${result.emptySummary} 件、` +
      (result.kept > 0 ? `前回より短いため据え置き ${result.kept} 件、` : "") +
      `取りこぼし ${result.missed} 件、未着手 ${remaining} 件、入力 ${input} tok / 出力 ${output} tok）` +
      (waits.count > 0 ? `\n  上限に当たって ${waits.count} 回・計 ${waits.seconds} 秒待った` : "") +
      (result.quotaDetail ? `\n  ※利用上限に達したため打ち切り — ${result.quotaDetail}` : ""),
  );
  return result;
}

/**
 * 和訳の候補。英語かつ未処理のもの、新しい順。
 * **タグ付けと違い social（HN）も対象にする**——/social/ は英語の見出しが並ぶページなので、
 * 和訳の効果が最も大きい。ただし HN はリンク集で本文を持たない（Algolia API が
 * リンク投稿に本文を返さない）ため、付くのは見出しだけで3行サマリは空になる。
 */
export function translateCandidates(
  articles: Iterable<Article>,
  { redoShort = false } = {},
): Article[] {
  return [...articles]
    .filter(
      (a) =>
        a.language === "en" &&
        // 未処理のもの。redoShort のときは「サマリが SUMMARY_LINES 行に満たない」記事も
        // 対象に戻す（リンク先の本文が取れるようになった等、材料が増えたときの作り直し）
        (!a.title_ja || (redoShort && (a.summary_ja?.length ?? 0) < SUMMARY_LINES)),
    )
    .sort((a, b) => (a.published_at === b.published_at ? 0 : a.published_at < b.published_at ? 1 : -1));
}
