import { GoogleGenAI } from "@google/genai";

/**
 * Gemini 無料枠を使う共通の土台。タグ付け・和訳など複数のジョブが
 * 1回の collect の中でこの Runner を共有し、リクエスト予算を1本で管理する。
 */

/** 実装時に models.list で実在を確認したモデル。無料枠の対象 */
export const MODEL = "gemini-3.5-flash-lite";

/**
 * 1実行あたりのリクエスト上限。
 * 無料枠は 100 req/日（AI Studio 実測値）で collect の cron は1日4回なので、
 * 1実行 20 に抑えて日80に収める（残り20は手動実行・再実行のための余裕）。
 */
export const MAX_REQUESTS_PER_RUN = 20;

/** 1リクエストにまとめる記事数 */
export const BATCH_SIZE = 25;

/** 無料枠の上限に当たったことを表す。捕まえた側は打ち切って正常終了する */
export class QuotaExceededError extends Error {
  constructor() {
    super("Gemini の利用上限に達した");
    this.name = "QuotaExceededError";
  }
}

/** 429 / RESOURCE_EXHAUSTED を判定する。SDK は状況により形の違うエラーを投げる */
function isQuotaError(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  if (status === 429) return true;
  const message = e instanceof Error ? e.message : String(e);
  return /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(message);
}

export function isLlmEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** 配列を size ごとに切る */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class LlmRunner {
  private readonly client: GoogleGenAI;
  private requests = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor() {
    this.client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  get usedRequests(): number {
    return this.requests;
  }

  get remainingRequests(): number {
    return Math.max(0, MAX_REQUESTS_PER_RUN - this.requests);
  }

  get tokens(): { input: number; output: number } {
    return { input: this.inputTokens, output: this.outputTokens };
  }

  /**
   * JSON を返させる1リクエスト。
   * - 予算切れ・429 は QuotaExceededError（呼び出し側は打ち切って正常終了する）
   * - パース失敗は null（その分の記事は次回実行で再び対象になる）
   */
  async json<T>(prompt: string, responseSchema: unknown): Promise<T | null> {
    if (this.remainingRequests === 0) throw new QuotaExceededError();
    this.requests++;

    let text: string | undefined;
    try {
      const response = await this.client.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema },
      });
      const usage = response.usageMetadata;
      this.inputTokens += usage?.promptTokenCount ?? 0;
      this.outputTokens += usage?.candidatesTokenCount ?? 0;
      text = response.text;
    } catch (e) {
      if (isQuotaError(e)) throw new QuotaExceededError();
      throw e;
    }

    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}
