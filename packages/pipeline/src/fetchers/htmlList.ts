import type { Source } from "@curation-fyi/shared";
import { normalizeUrl } from "../normalize.ts";
import type { FetchedItem } from "./types.ts";

/**
 * RSS/Atom を持たないサイトを一覧ページのHTMLから収集する。
 *
 * **役割分担を固定してある**（2026-08-22 に対象4サイトで実測して決めた）:
 * - 一覧ページ … 記事URL と **公開日**。記事ページ側は4サイトとも日付メタ
 *   （article:published_time / JSON-LD / <time datetime>）を1つも持っていない
 * - 記事ページ … タイトルと要約。og:title / <title> は4サイトとも持っている。
 *   一覧のカードからタイトルを切り出す方式はサイトごとにDOMが違いすぎる
 *
 * **日付は `<a>` の内側からしか取らない。** 近傍の文字数窓で拾う方式は、前後どちらの
 * カードの日付かを決められず、1件ずれても「もっともらしい日付」になって表に出ない。
 * 実測では Manus 112/112・napkin 16/16 がアンカー内側に日付を持つ（2026-08-22）。
 * 一覧に日付が無いサイトは date_from_slug（DeepSeek）を使う。
 *
 * 日付が取れない項目は捨てる（rss fetcher と同じ）。nav のリンクが link_pattern に
 * 引っかかっても日付を持たないので、この規則が実質のフィルタになる。
 *
 * 例外が date_from_article_head（paulgraham.com）で、日付は**記事ページ本文の冒頭**にしかない。
 * このときだけ一覧では日付を確定せず、記事ページを取ってから捨てる。捨てる規則は同じ。
 *
 * 記事ページの取得は **未知のURLだけ**。2回目以降の collect は一覧1リクエストで済む。
 */

const USER_AGENT = "curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)";
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 4;
const DEFAULT_MAX_ITEMS = 40;
/** <a> の内側テキストとして見る上限。閉じタグを見失ったときに全文を舐めないための保険 */
const MAX_ANCHOR_TEXT = 2_000;
/**
 * date_from_article_head で日付を探す本文冒頭の文字数。
 * paulgraham.com 全232本の実測で、日付の出現位置は最大311文字・95%が84文字以内（2026-08-25）。
 * 冒頭に長い注記を置く essay（distraction.html）が311文字なので、そこまで届く幅を取る。
 */
const ARTICLE_HEAD_CHARS = 400;

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** 一覧のカードに現れる日付表記。実測した3形式だけを見る */
const DATE_PATTERNS: RegExp[] = [
  /(\d{4})-(\d{2})-(\d{2})/,
  /([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/,
];

function parseDate(text: string): string | null {
  for (const re of DATE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    if (re.source.startsWith("(\\d{4})")) {
      return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
    }
    const month = MONTHS[(m[1] ?? "").toLowerCase()];
    if (!month) continue;
    const day = Number(m[2]);
    const year = Number(m[3]);
    return new Date(Date.UTC(year, month - 1, day)).toISOString();
  }
  return null;
}

/**
 * 記事ページ本文の冒頭にある「Month YYYY」。日は持たないので1日に丸める。
 * コメント（paulgraham.com は旧タイトルを <!-- --> で残している）を先に落としてから探す。
 */
function parseMonthYearHead(html: string): string | null {
  const head = stripTags(html.replace(/<!--[\s\S]*?-->/g, " ")).slice(0, ARTICLE_HEAD_CHARS);
  // 月名でない「語+西暦」（"Viaweb 1998" 等）で打ち切らないよう、最初に月名と読めたものを採る
  for (const m of head.matchAll(/\b([A-Z][a-z]+)\s+(\d{4})\b/g)) {
    const month = MONTHS[(m[1] ?? "").toLowerCase()];
    if (month) return new Date(Date.UTC(Number(m[2]), month - 1, 1)).toISOString();
  }
  return null;
}

/** slug に YYMMDD が埋まっている形式（DeepSeek の /news/news260821）。一覧に日付が無いサイト用 */
function dateFromSlug(url: string, pattern: string): string | null {
  const m = new RegExp(pattern).exec(url);
  if (!m) return null;
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!yy || !mm || !dd || mm > 12 || dd > 31) return null;
  return new Date(Date.UTC(2000 + yy, mm - 1, dd)).toISOString();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;|&#38;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

/** property と content の順序が逆でも拾う */
function metaContent(html: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']+)`, "i").exec(html);
  if (a?.[1]) return decodeEntities(a[1]);
  const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${esc}["']`, "i").exec(html);
  return b?.[1] ? decodeEntities(b[1]) : null;
}

async function get(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface Candidate {
  url: string;
  /** date_from_article_head のときだけ null。記事ページを取った後で確定する */
  publishedAt: string | null;
}

/** 一覧ページから「記事URLと公開日」を取り出す。日付はアンカーの内側だけを見る */
function extractCandidates(html: string, listUrl: string, source: Source): Candidate[] {
  const config = source.html_list;
  if (!config) return [];
  const linkRe = new RegExp(config.link_pattern);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  // 引用符なしの属性（napkin.ai）も拾う
  for (const m of html.matchAll(/<a\b[^>]*href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/g)) {
    const href = m[1] ?? m[2] ?? m[3];
    if (!href || !linkRe.test(href)) continue;
    let absolute: string;
    try {
      absolute = normalizeUrl(new URL(href, listUrl).toString());
    } catch {
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    let publishedAt: string | null;
    if (config.date_from_article_head) {
      publishedAt = null; // 記事ページを見るまで決まらない
    } else if (config.date_from_slug) {
      publishedAt = dateFromSlug(absolute, config.date_from_slug);
    } else {
      const start = m.index + m[0].length;
      const close = html.indexOf("</a>", start);
      const end = close < 0 ? start + MAX_ANCHOR_TEXT : Math.min(close, start + MAX_ANCHOR_TEXT);
      publishedAt = parseDate(stripTags(html.slice(start, end)));
    }
    if (!publishedAt && !config.date_from_article_head) continue;
    out.push({ url: absolute, publishedAt });
  }
  return out;
}

export async function fetchHtmlList(
  source: Source,
  known: { has(url: string): boolean },
): Promise<{ items: FetchedItem[]; notModified: boolean }> {
  const config = source.html_list;
  if (!config) throw new Error(`html_list の設定が無い: ${source.id}`);
  const listUrl = config.list_url ?? source.site_url;
  const listHtml = await get(listUrl);
  if (!listHtml) throw new Error(`一覧ページを取得できない: ${listUrl}`);

  const candidates = extractCandidates(listHtml, listUrl, source).slice(0, config.max_items ?? DEFAULT_MAX_ITEMS);
  // 既知のURLは記事ページを取りに行かない。2回目以降は一覧1リクエストで終わる
  const fresh = candidates.filter((c) => !known.has(c.url));

  const titleStrip = config.title_strip;
  const items: FetchedItem[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < fresh.length) {
      const c = fresh[cursor++];
      if (!c) return;
      const page = await get(c.url);
      if (!page) continue;
      const publishedAt = c.publishedAt ?? parseMonthYearHead(page);
      if (!publishedAt) continue; // 冒頭に日付が無いページ（nav・記事以外）はここで落ちる
      const title =
        metaContent(page, "og:title") ??
        (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page)?.[1]?.trim() ?? "");
      if (!title) continue;
      const stripped = titleStrip ? title.replace(new RegExp(titleStrip), "").trim() : title;
      if (!stripped) continue;
      const summary = metaContent(page, "og:description") ?? metaContent(page, "description");
      items.push({
        url: c.url,
        title: stripTags(stripped),
        summary: summary ? stripTags(summary) : null,
        published_at: publishedAt,
        language: source.language === "mixed" ? "en" : source.language,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fresh.length) }, worker));
  return { items, notModified: false };
}
