import { Type } from "@google/genai";
import type { Article, Tag } from "@curation-fyi/shared";
import { BATCH_SIZE, chunk, type LlmRunner, QuotaExceededError } from "../llm/gemini.ts";

/** レスポンスの形。記事は index で対応づける（順序ズレ・件数不足で他の記事を巻き込まないため） */
const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      i: { type: Type.INTEGER, description: "記事番号" },
      tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["i", "tags"],
  },
};

interface TagAnswer {
  i: number;
  tags: string[];
}

function buildPrompt(articles: Article[], taxonomy: Tag[]): string {
  const tagList = taxonomy.map((t) => `- ${t.slug}: ${t.name}`).join("\n");
  const articleList = articles
    .map((a, i) => `${i}. タイトル: ${a.title}\n   要約: ${a.summary ?? "（なし）"}`)
    .join("\n");
  return `以下の技術記事それぞれに合うタグを、タグ一覧から0〜3個選んでください。
どれにも合わなければ空配列にしてください。記事番号 i は入力のものをそのまま返してください。
全 ${articles.length} 件について、漏れなく1件ずつ返してください。

タグ一覧:
${tagList}

記事:
${articleList}`;
}

/** taxonomy に存在する slug のみを taxonomy の順で返す */
function knownTags(tags: unknown, taxonomy: Tag[]): string[] {
  if (!Array.isArray(tags)) return [];
  const known = new Set(taxonomy.map((t) => t.slug));
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t === "string" && known.has(t)) seen.add(t);
  }
  return taxonomy.filter((t) => seen.has(t.slug)).map((t) => t.slug);
}

export interface LlmTagResult {
  /** llm_tags を更新した記事（タグが0個のままだったものも含む） */
  updated: Article[];
  processed: number;
  /** レスポンスに現れず今回付けられなかった記事数。次回実行で再び対象になる */
  missed: number;
  requests: number;
  /** 打ち切った理由（どの上限に当たったか）。打ち切っていなければ null */
  quotaDetail: string | null;
}

/**
 * tags も llm_tags も空の記事に Gemini でタグを付ける。
 * 1リクエストに BATCH_SIZE 件をまとめ、予算（runner）が尽きたら打ち切って正常に返す。
 */
export async function tagWithLlm(
  candidates: Article[],
  taxonomy: Tag[],
  runner: LlmRunner,
): Promise<LlmTagResult> {
  const result: LlmTagResult = {
    updated: [],
    processed: 0,
    missed: 0,
    requests: 0,
    quotaDetail: null,
  };
  if (candidates.length === 0) {
    console.log("LLMタグ付け: 対象記事なし");
    return result;
  }

  for (const batch of chunk(candidates, BATCH_SIZE)) {
    let answers: TagAnswer[] | null;
    try {
      answers = await runner.json<TagAnswer[]>(buildPrompt(batch, taxonomy), RESPONSE_SCHEMA);
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
      console.error(`✗ LLMタグ付け: レスポンスが配列でないためバッチ${batch.length}件をスキップ`);
      continue;
    }

    const applied = new Set<number>();
    for (const answer of answers) {
      const article = batch[answer?.i as number];
      if (!article || applied.has(answer.i)) continue; // 範囲外・重複は無視
      article.llm_tags = knownTags(answer.tags, taxonomy);
      result.updated.push(article);
      applied.add(answer.i);
    }
    result.processed += applied.size;
    result.missed += batch.length - applied.size;
  }

  const remaining = candidates.length - result.processed - result.missed;
  const { input, output } = runner.tokens;
  console.log(
    `LLMタグ付け: ${result.processed} 件処理（${result.requests} リクエスト、` +
      `取りこぼし ${result.missed} 件、未着手 ${remaining} 件、入力 ${input} tok / 出力 ${output} tok）` +
      (result.quotaDetail ? `\n  ※利用上限に達したため打ち切り — ${result.quotaDetail}` : ""),
  );
  return result;
}
