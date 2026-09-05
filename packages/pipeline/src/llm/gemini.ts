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
 * 「この実行ではもう続けられないが、異常ではない」ことを表す基底クラス。
 * 捕まえた側は打ち切って正常終了し、残りは次回の実行に回す。
 * **付加的な工程（タグ付け・和訳）の中断で収集そのものを落とさないための境界**で、
 * これに当たらない例外は実装の不具合として扱う。
 */
export abstract class LlmStopError extends Error {
  /** ログに出す打ち切り理由（「利用上限」等）。文中に埋めるので体言止めにする */
  abstract readonly label: string;
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

/**
 * 無料枠の上限に当たったことを表す。
 * どの制限（日次・分あたり・トークン数）に当たったかは応答本文にしか出ないので、
 * detail に残してログに出す（バッチサイズの調整に必要）
 */
export class QuotaExceededError extends LlmStopError {
  readonly label = "利用上限";
  constructor(detail: string) {
    super("Gemini の利用上限に達した", detail);
    this.name = "QuotaExceededError";
  }
}

/**
 * モデル側の一過性の障害（503 UNAVAILABLE / 500 / 504）。
 * 応答は "Spikes in demand are usually temporary" と言うとおり待てば解けるので、
 * json() が数回バックオフして再試行し、それでも駄目ならこれを投げて次回に回す。
 * **利用上限と同じく「異常ではない打ち切り」**として扱う（再試行で自己回復するため、
 * これで CI を赤くしても対処できることが無い）。
 */
export class ServiceUnavailableError extends LlmStopError {
  readonly label = "モデル側の一時的な過負荷";
  constructor(detail: string) {
    super("Gemini が一時的に応答できない", detail);
    this.name = "ServiceUnavailableError";
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
 * モデル側の一過性の障害を判定する。503 UNAVAILABLE が主だが、
 * 500 / 504 も同じく「待てば解ける」側なので同列に扱う。
 * 429（利用上限）は待ち時間が本文で申告されるので、そちらは isQuotaError で切る。
 */
function isTransientServerError(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  if (status === 503 || status === 500 || status === 504) return true;
  const message = e instanceof Error ? e.message : String(e);
  return /\b(503|500|504)\b|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED/.test(message);
}

/**
 * 一過性障害で待つ秒数。429 と違い応答が retryDelay を持たないので固定値を使う。
 * CI のジョブ（timeout-minutes: 15）に収めるため、合計 20 秒に留める。
 */
const TRANSIENT_BACKOFF_SECONDS = [5, 15];

/**
 * エラー本文から、ログに残す説明を組み立てる。429 なら当たった制限を要約に足す。
 * 本文は ApiError.message に JSON がそのまま入る（実測で確認）。
 * ただし 429 の details[] の入れ子は実物で確認できていないので、
 * 平坦な文字列一致で拾えるものだけを要約に足し、拾えなくても本文全体を残す。
 */
function describeApiError(e: unknown): string {
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
  /** いま走っている段階の取り分。null なら実行全体の残り全部を使える */
  private stageLimit: number | null = null;
  /** 段階が始まった時点の requests。段階の消費量を測るための基準 */
  private stageStart = 0;
  private stageName = "";
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

  /**
   * 段階の取り分を宣言する。**同じ実行に複数の段階が同居すると、先に走る段階が
   * 予算を使い切って後続を飢餓させる**——実際、タグ付けが枠を食って和訳が
   * 20時間0件になった。段階ごとに上限を切ることで、後続の取り分を残す。
   * maxRequests に null を渡すと残り全部（最後の段階に使う）。
   */
  beginStage(name: string, maxRequests: number | null): void {
    this.stageName = name;
    this.stageLimit = maxRequests;
    this.stageStart = this.requests;
  }

  get remainingRequests(): number {
    const runRemaining = Math.max(0, MAX_REQUESTS_PER_RUN - this.requests);
    if (this.stageLimit === null) return runRemaining;
    const stageRemaining = Math.max(0, this.stageLimit - (this.requests - this.stageStart));
    return Math.min(runRemaining, stageRemaining);
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
        // 実行全体を使い切ったのか、この段階の取り分を使い切ったのかを区別して残す
        const runExhausted = this.requests >= MAX_REQUESTS_PER_RUN;
        throw new QuotaExceededError(
          runExhausted
            ? `1実行あたりの予算 ${MAX_REQUESTS_PER_RUN} リクエストを使い切った（API側の上限ではない）`
            : `${this.stageName} の取り分 ${this.stageLimit} リクエストを使い切った` +
              `（実行全体では残り ${MAX_REQUESTS_PER_RUN - this.requests}。API側の上限ではない）`,
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
        if (isTransientServerError(e)) {
          const detail = describeApiError(e);
          const seconds = TRANSIENT_BACKOFF_SECONDS[attempt];
          // 待ち時間を用意していない回数まで来たら諦めて次回の実行に回す
          if (seconds === undefined) throw new ServiceUnavailableError(detail);
          this.retries++;
          this.waitedSeconds += seconds;
          console.log(
            `  モデル側が応答できないので ${seconds} 秒待って再試行する` +
              `（${attempt + 1}/${TRANSIENT_BACKOFF_SECONDS.length}）`,
          );
          await sleep(seconds * 1000);
          continue;
        }
        if (!isQuotaError(e)) throw e;
        const detail = describeApiError(e);
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
