import Parser from "rss-parser";
import type { Source } from "@curation-fyi/shared";
import { detectLanguage, normalizeUrl } from "../normalize.ts";
import type { SourceState } from "../state.ts";
import type { FetchedItem } from "./types.ts";

const USER_AGENT = "curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)";

const parser = new Parser({
  timeout: 20_000,
  headers: { "User-Agent": USER_AGENT },
  customFields: { item: ["content:encoded"] },
});

const SUMMARY_MAX = 300;
const CODE_BLOCK = /<pre[\s>]|<code[\s>]/;

export function toSummary(snippet: string | undefined): string | null {
  if (!snippet) return null;
  const text = snippet.replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return text.length > SUMMARY_MAX ? text.slice(0, SUMMARY_MAX) + "…" : text;
}

interface RssItem {
  link?: string;
  title?: string;
  contentSnippet?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  "content:encoded"?: string;
}

function detectHasCode(item: RssItem): boolean | null {
  const body = item["content:encoded"] ?? item.content;
  if (!body) return null;
  return CODE_BLOCK.test(body);
}

export interface RssFetchResult {
  items: FetchedItem[];
  notModified: boolean;
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
  for (const item of feed.items as RssItem[]) {
    if (!item.link || !item.title) continue;
    const publishedAt = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null);
    if (!publishedAt) continue;
    const title = item.title.trim();
    const summary = toSummary(item.contentSnippet);
    items.push({
      url: normalizeUrl(item.link),
      title,
      summary,
      published_at: publishedAt,
      language:
        source.language === "mixed" ? detectLanguage(`${title} ${summary ?? ""}`, "en") : source.language,
      has_code: detectHasCode(item),
    });
  }
  return {
    items,
    notModified: false,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}
