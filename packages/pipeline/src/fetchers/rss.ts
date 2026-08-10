import Parser from "rss-parser";
import type { Source } from "@curation-fyi/shared";
import { normalizeUrl } from "../normalize.ts";
import type { SourceState } from "../state.ts";
import type { FetchedItem } from "./types.ts";

const USER_AGENT = "curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)";

const parser = new Parser({
  timeout: 20_000,
  headers: { "User-Agent": USER_AGENT },
});

const SUMMARY_MAX = 300;

export function toSummary(snippet: string | undefined): string | null {
  if (!snippet) return null;
  const text = snippet.replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return text.length > SUMMARY_MAX ? text.slice(0, SUMMARY_MAX) + "…" : text;
}

export interface RssFetchResult {
  items: FetchedItem[];
  notModified: boolean;
  /** 200応答時のみ設定。ヘッダが無ければnull */
  etag?: string | null;
  lastModified?: string | null;
}

export async function fetchRss(source: Source, state: SourceState): Promise<RssFetchResult> {
  if (!source.feed_url) {
    throw new Error(`feed_url がありません: ${source.id}`);
  }
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (state.etag) headers["If-None-Match"] = state.etag;
  if (state.last_modified) headers["If-Modified-Since"] = state.last_modified;

  const res = await fetch(source.feed_url, { headers });
  if (res.status === 304) {
    return { items: [], notModified: true };
  }
  if (!res.ok) {
    throw new Error(`Status code ${res.status}`);
  }

  const body = await res.text();
  const feed = await parser.parseString(body);
  const items: FetchedItem[] = [];
  for (const item of feed.items) {
    if (!item.link || !item.title) continue;
    const publishedAt = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null);
    if (!publishedAt) continue;
    items.push({
      url: normalizeUrl(item.link),
      title: item.title.trim(),
      summary: toSummary(item.contentSnippet),
      published_at: publishedAt,
      // mixed言語ソースの記事単位判定は v0.5 で tinyld を導入する
      language: source.language === "mixed" ? "en" : source.language,
    });
  }
  return {
    items,
    notModified: false,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}
