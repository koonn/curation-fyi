import { GoogleGenAI } from "@google/genai";

/**
 * Gemini 無料枠を使う共通の土台。タグ付け・和訳など複数のジョブが
 * 1回の collect の中でこの Runner を共有し、リクエスト予算を1本で管理する。
 */

/** 実装時に models.list で実在を確認したモデル。無料枠の対象 */
export const MODEL = "gemini-3.5-flash-lite";

/**
 * 1実行あたりのリクエスト上限。cron は1日4回なので日80に収まる。
 *
 * 当初は「無料枠 100 req/日が律速」という前提でこの値を決めたが、**それは誤りだった**。
 * 実測（2026-08-21）で律速は **15 RPM**（GenerateRequestsPerMinutePerProjectPerModel-FreeTier）で、
 * この値に達する前に分あたりの上限に当たる。分あたりは待てば解けるので json() が
 * retryDelay ぶん待って再試行する。この定数は日次の使いすぎを抑える役目として残す。
 */
export const MAX_REQUESTS_PER_RUN = 20;

/** 429 を受けたときに待って再試行する回数の上限（1リクエストあたり） */
const MAX_RETRIES_PER_REQUEST = 2;

/**
 * これを超える retryDelay は待たずに諦める。
 * 分あたりの上限なら20秒程度で解けるが、日次の上限に当たった場合の retryDelay は
 * 桁違いに長い。CI のジョブ内で待てる長さではないので、そこで打ち切って次回に回す。
 * **待ち時間の長さで「待てば解ける制限」と「今日はもう無理な制限」を切り分けている。**
 */
const MAX_RETRY_SECONDS = 90;

/** 1リクエストにまとめる記事数 */
export const BATCH_SIZE = 25;

/**
 * 無料枠の上限に当たったことを表す。捕まえた側は打ち切って正常終了する。
 * どの制限（日次・分あたり・トークン数）に当たったかは応答本文にしか出ないので、
 * detail に残してログに出す（バッチサイズの調整に必要）
 */
export class QuotaExceededError extends Error {
  constructor(readonly detail: string) {
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

/**
 * 429 の本文から、どの制限に当たったかをログ用に取り出す。
 * 本文は ApiError.message に JSON がそのまま入る（実測で確認）。
 * ただし 429 の details[] の入れ子は実物で確認できていないので、
 * 平坦な文字列一致で拾えるものだけを要約に足し、拾えなくても本文全体を残す。
 */
function describeQuotaError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const ids = [...raw.matchAll(/"(?:quotaId|quotaMetric)"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const retry = raw.match(/"retryDelay"\s*:\s*"([^"]+)"/)?.[1];
  const summary = [
    ids.length > 0 ? `制限: ${[...new Set(ids)].join(", ")}` : null,
    retry ? `再試行まで ${retry}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const body = raw.length > 800 ? `${raw.slice(0, 800)}…` : raw;
  return summary ? `${summary} | ${body}` : body;
}

/**
 * 429 の本文から待つべき秒数を取り出す。読めなければ null（＝待たずに諦める）。
 * 本文には "retryDelay": "20.342417174s" と、文中の "Please retry in 20.34s" の
 * 両方の形で出ることがあるので、どちらでも拾う。
 */
function retryDelaySeconds(e: unknown): number | null {
  const raw = e instanceof Error ? e.message : String(e);
  const m =
    raw.match(/"retryDelay"\s*:\s*"([\d.]+)s"/) ?? raw.match(/retry in\s+([\d.]+)\s*s/i);
  if (!m) return null;
  const seconds = Number(m[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  private retries = 0;
  private waitedSeconds = 0;
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

  /** 429 を受けて待ち直した回数と、その合計秒数。ログに出して頻度を見る */
  get waits(): { count: number; seconds: number } {
    return { count: this.retries, seconds: this.waitedSeconds };
  }

  /**
   * JSON を返させる1リクエスト。
   * - 予算切れ・429 は QuotaExceededError（呼び出し側は打ち切って正常終了する）
   * - パース失敗は null（その分の記事は次回実行で再び対象になる）
   */
  async json<T>(prompt: string, responseSchema: unknown): Promise<T | null> {
    let text: string | undefined;

    // 429 は「待てば解ける」ことがあるので、応答が申告する retryDelay ぶん待って再試行する。
    // 待ち時間が MAX_RETRY_SECONDS を超えるとき（日次の上限）は待たずに諦める
    for (let attempt = 0; ; attempt++) {
      if (this.remainingRequests === 0) {
        throw new QuotaExceededError(
          `1実行あたりの予算 ${MAX_REQUESTS_PER_RUN} リクエストを使い切った（API側の上限ではない）`,
        );
      }
      this.requests++;

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
        break;
      } catch (e) {
        if (!isQuotaError(e)) throw e;
        const detail = describeQuotaError(e);
        const wait = retryDelaySeconds(e);
        if (attempt >= MAX_RETRIES_PER_REQUEST || wait === null || wait > MAX_RETRY_SECONDS) {
          throw new QuotaExceededError(detail);
        }
        // 境界ちょうどで叩き直さないよう1秒足す
        const seconds = Math.ceil(wait) + 1;
        this.retries++;
        this.waitedSeconds += seconds;
        console.log(
          `  上限に当たったので ${seconds} 秒待って再試行する` +
            `（${attempt + 1}/${MAX_RETRIES_PER_REQUEST}）`,
        );
        await sleep(seconds * 1000);
      }
    }

    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}
