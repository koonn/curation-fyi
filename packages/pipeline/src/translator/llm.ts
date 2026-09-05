import { Type } from "@google/genai";
import type { Article } from "@curation-fyi/shared";
import { BATCH_SIZE, chunk, type LlmRunner, LlmStopError } from "../llm/gemini.ts";

/** サマリの行数。カードの表示もこの数を前提にする */
const SUMMARY_LINES = 3;

/**
 * 英語記事は「見出しの和訳＋3行サマリ」、日本語記事は「3行サマリ」だけを作る。
 * 日本語記事は原文で読めるので見出しの訳は要らないが、**読む時間を減らす**という
 * 目的にはサマリが効く。
 */
type Mode = "translate" | "summarize";

const SUMMARY_FIELD = {
  type: Type.ARRAY,
  items: { type: Type.STRING },
  description: `要点を${SUMMARY_LINES}行。情報が足りなければ行を減らすか空にする`,
};

/** レスポンスの形。記事は index で対応づける（順序ズレ・件数不足で他の記事を巻き込まないため） */
function responseSchema(mode: Mode): unknown {
  const translate = mode === "translate";
  return {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        i: { type: Type.INTEGER, description: "記事番号" },
        // **突き合わせ用**。i だけでは対応の正しさを検証できないため、入力のタイトルを
        // そのまま返させて照合する（実測でサマリが記事間でずれる事故が起きた）
        echo: { type: Type.STRING, description: "入力のタイトルの先頭20文字をそのまま返す" },
        ...(translate ? { title_ja: { type: Type.STRING, description: "和訳した見出し" } } : {}),
        summary_ja: SUMMARY_FIELD,
      },
      required: translate ? ["i", "echo", "title_ja", "summary_ja"] : ["i", "echo", "summary_ja"],
    },
  };
}

interface TranslateAnswer {
  i: number;
  /** 入力タイトルの写し。i との対応が正しいかの照合に使う */
  echo?: string;
  title_ja?: string;
  summary_ja: string[];
}

/** 照合用にタイトルを正規化する。空白・記号のゆれを吸収し、先頭だけを見る */
function titleKey(title: string): string {
  return title
    .replace(/\s+/g, "")
    .replace(/[|｜\-–—:：・、。,.'"“”'']/g, "")
    .toLowerCase()
    .slice(0, 12);
}

function buildPrompt(articles: Article[], bodies: Map<string, string>, mode: Mode): string {
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
  const caution = `summary_ja の注意:
- **見出しの言い換えを並べない**。見出しから分かること以外の中身を書く
- **与えられた情報に書かれていないことは書かない**。推測で補わない
- タイトルしか無く要点が取れない場合は、無理に${SUMMARY_LINES}行にせず、行を減らすか空配列にする`;
  const common = `記事番号 i は入力のものをそのまま返し、全 ${articles.length} 件を漏れなく1件ずつ返してください。
echo には、その記事の「タイトル:」に書かれた文字列の先頭20文字をそのまま写してください（照合に使います）。`;

  if (mode === "summarize") {
    return `以下は日本語の技術記事です。それぞれについて内容の要点を日本語で作ってください。
${common}

summary_ja: 内容の要点を${SUMMARY_LINES}行。各行は40字程度の短い文にする

${caution}

記事:
${list}`;
  }

  return `以下は英語の技術記事です。それぞれについて次の2つを日本語で作ってください。
${common}

1. title_ja: 見出しの和訳。直訳ではなく、日本語の技術記事の見出しとして自然な形にする
2. summary_ja: 内容の要点を${SUMMARY_LINES}行。各行は40字程度の短い文にする

${caution}

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
  /** タイトルの照合に失敗して捨てた件数。記事間のずれを検出したもの */
  mismatched: number;
  /** レスポンスに現れなかった・見出しが空で捨てた件数。次回実行で再び対象になる */
  missed: number;
  requests: number;
  /** 打ち切った理由（どの上限に当たったか）。打ち切っていなければ null */
  /** 打ち切った理由。利用上限・モデル側の過負荷など。null なら最後まで回った */
  stopped: LlmStopError | null;
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
  { force = false } = {},
): Promise<TranslateResult> {
  const result: TranslateResult = {
    updated: [],
    processed: 0,
    shortSummary: 0,
    emptySummary: 0,
    kept: 0,
    mismatched: 0,
    missed: 0,
    requests: 0,
    stopped: null,
  };
  if (candidates.length === 0) {
    console.log("和訳: 対象記事なし");
    return result;
  }

  /** 1つの言語ぶんをバッチで処理する。打ち切りに当たったら stopped を立てて止まる */
  const runBatches = async (articles: Article[], mode: Mode): Promise<void> => {
    const schema = responseSchema(mode);
    for (const batch of chunk(articles, BATCH_SIZE)) {
      if (result.stopped) return;
      let answers: TranslateAnswer[] | null;
      try {
        answers = await runner.json<TranslateAnswer[]>(buildPrompt(batch, bodies, mode), schema);
      } catch (e) {
        if (e instanceof LlmStopError) {
          result.stopped = e;
          return;
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
        // **i の対応を信じない。** 入力タイトルの写しと突き合わせ、合わなければ捨てる。
        // 実測: 照合が無かったとき、日本語498件のうち判定できた313件中20件で
        // 別記事のサマリが書き込まれていた（DbGateの記事に熱雑音の要約、等）
        const echo = typeof answer.echo === "string" ? titleKey(answer.echo) : "";
        if (echo === "" || !titleKey(article.title).startsWith(echo.slice(0, 8))) {
          result.mismatched++;
          continue;
        }
        if (mode === "translate") {
          const title = typeof answer.title_ja === "string" ? answer.title_ja.trim() : "";
          // 見出しが空なら書き込まない＝この記事だけ次回に残る（他は巻き込まない）
          if (title === "") continue;
          article.title_ja = title;
        }
        const lines = cleanLines(answer.summary_ja);
        // **やり直しで結果が悪くなることがある**（モデルは非決定的で、同じ入力でも
        // 行数が減ることがある）。前回より行数が少ないなら前回を残す——上書きは
        // 情報が増える方向にだけ動かす。実測: 無条件上書きにしていた実行で、
        // 1〜2行あった記事14件が空で塗り潰された
        // force のときは前回を信用しない（照合が無かった頃の値を入れ替えるため）
        const previous = article.summary_ja ?? [];
        if (force || lines.length >= previous.length) article.summary_ja = lines;
        else result.kept++;
        const settled = article.summary_ja ?? [];
        if (settled.length === 0) result.emptySummary++;
        else if (settled.length < SUMMARY_LINES) result.shortSummary++;
        result.updated.push(article);
        applied.add(answer.i);
      }
      result.processed += applied.size;
      result.missed += batch.length - applied.size;
    }
  };

  // 英語は見出しの和訳つき、日本語はサマリだけ。プロンプトと応答の形が違うので分けて回す
  const english = candidates.filter((a) => a.language === "en");
  const japanese = candidates.filter((a) => a.language === "ja");
  if (english.length > 0) await runBatches(english, "translate");
  if (japanese.length > 0) await runBatches(japanese, "summarize");

  const remaining = candidates.length - result.processed - result.missed;
  const { input, output } = runner.tokens;
  const waits = runner.waits;
  console.log(
    `和訳: ${result.processed} 件処理（${result.requests} リクエスト、` +
      `サマリ${SUMMARY_LINES}行未満 ${result.shortSummary} 件、サマリ空 ${result.emptySummary} 件、` +
      (result.kept > 0 ? `前回より短いため据え置き ${result.kept} 件、` : "") +
      (result.mismatched > 0 ? `**タイトル不一致で破棄 ${result.mismatched} 件**、` : "") +
      `取りこぼし ${result.missed} 件、未着手 ${remaining} 件、入力 ${input} tok / 出力 ${output} tok）` +
      (waits.count > 0 ? `\n  上限に当たって ${waits.count} 回・計 ${waits.seconds} 秒待った` : "") +
      (result.stopped ? `\n  ※${result.stopped.label}のため打ち切り — ${result.stopped.detail}` : ""),
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
  { redoShort = false, redoAll = false } = {},
): Article[] {
  return [...articles]
    .filter((a) => {
      // 未処理かどうかの見方が言語で違う。
      // 英語: title_ja の有無（和訳見出しは正当に空にならないのでフラグを兼ねられる）
      // 日本語: summary_ja のキーの有無。**undefined＝未処理 / [] ＝処理したが該当なし**で
      //   区別できる（既定値として書かれることがないため。L159 の落とし穴を避けている）
      const fresh = a.language === "en" ? !a.title_ja : a.summary_ja === undefined;
      if (a.language !== "en" && a.language !== "ja") return false;
      // redoAll: 過去の生成物を信用せず全件作り直す（タイトル照合が無かった頃の
      // 出力には記事間のずれが混ざっているため）
      if (redoAll) return true;
      // redoShort のときは「サマリが SUMMARY_LINES 行に満たない」記事も対象に戻す
      // （リンク先の本文が取れるようになった等、材料が増えたときの作り直し）
      return fresh || (redoShort && (a.summary_ja?.length ?? 0) < SUMMARY_LINES);
    })
    .sort((a, b) => {
      if (a.published_at === b.published_at) return 0;
      // 通常は新しい順（トップに出る記事から埋める）。
      // **redoAll のときは古い順**——全件を offset で順に舐めるため、新着が届いても
      // 既に処理した範囲の位置がずれないようにする（新着は末尾に付く）
      const older = a.published_at < b.published_at;
      return redoAll ? (older ? -1 : 1) : older ? 1 : -1;
    });
}
