import Anthropic from "@anthropic-ai/sdk";
import type { Article, Tag } from "@curation-fyi/shared";

/** 1回の実行で LLM に投げる記事数の上限。超過分は次回実行に回る */
const MAX_LLM_PER_RUN = 100;
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 300;

// Haiku 4.5 の料金（$/MTok）。ログのコスト概算に使う
const PRICE_INPUT_PER_MTOK = 1;
const PRICE_OUTPUT_PER_MTOK = 5;

function buildPrompt(article: Article, taxonomy: Tag[]): string {
  const tagList = taxonomy.map((t) => `- ${t.slug}: ${t.name}`).join("\n");
  return `以下の技術記事に合うタグを、タグ一覧から0〜3個選んでください。
どれにも合わなければ空配列にしてください。JSONのみを出力してください。

タグ一覧:
${tagList}

記事タイトル: ${article.title}
記事要約: ${article.summary ?? ""}

出力形式: {"tags": ["slug1", "slug2"]}`;
}

/** レスポンステキストから taxonomy に存在する slug のみを取り出す。parse 失敗は null */
function parseTags(text: string, taxonomy: Tag[]): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const tags = (parsed as { tags?: unknown })?.tags;
  if (!Array.isArray(tags)) return null;
  const known = new Set(taxonomy.map((t) => t.slug));
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t === "string" && known.has(t)) seen.add(t);
  }
  return taxonomy.filter((t) => seen.has(t.slug)).map((t) => t.slug);
}

export interface LlmTagResult {
  /** llm_tags を更新した記事（tags が0個のままだったものも含む） */
  updated: Article[];
  processed: number;
  parseFailed: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * tags も llm_tags も空の記事に LLM でタグを付ける。
 * ANTHROPIC_API_KEY が未設定なら何もせずスキップする。
 */
export async function tagWithLlm(candidates: Article[], taxonomy: Tag[]): Promise<LlmTagResult> {
  const empty: LlmTagResult = {
    updated: [],
    processed: 0,
    parseFailed: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("LLMタグ付け: APIキー未設定のためスキップ");
    return empty;
  }
  const targets = candidates.slice(0, MAX_LLM_PER_RUN);
  if (targets.length === 0) {
    console.log("LLMタグ付け: 対象記事なし");
    return empty;
  }

  const client = new Anthropic();
  const result: LlmTagResult = { ...empty, updated: [] };

  for (const article of targets) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: buildPrompt(article, taxonomy) }],
    });
    result.inputTokens += response.usage.input_tokens;
    result.outputTokens += response.usage.output_tokens;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const tags = parseTags(text, taxonomy);
    if (tags === null) {
      // リトライはしない。次回実行で再び対象になる
      result.parseFailed++;
      console.error(`✗ LLMタグ付け: JSONパース失敗 (${article.url}): ${text.slice(0, 80)}`);
      continue;
    }
    article.llm_tags = tags;
    result.updated.push(article);
    result.processed++;
  }

  const cost =
    (result.inputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
    (result.outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  console.log(
    `LLMタグ付け: ${result.processed} 件処理` +
      `（パース失敗 ${result.parseFailed} 件、入力 ${result.inputTokens} tok / 出力 ${result.outputTokens} tok、概算 $${cost.toFixed(4)}）`,
  );
  return result;
}
