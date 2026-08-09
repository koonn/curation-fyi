import Parser from "rss-parser";
import type { Language, Source } from "@curation-fyi/shared";
import { normalizeUrl } from "../normalize.ts";

export interface FetchedItem {
  url: string;
  title: string;
  summary: string | null;
  published_at: string;
  language: Language;
}

const parser = new Parser({
  timeout: 20_000,
  headers: { "User-Agent": "curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)" },
});

const SUMMARY_MAX = 300;

function toSummary(snippet: string | undefined): string | null {
  if (!snippet) return null;
  const text = snippet.replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return text.length > SUMMARY_MAX ? text.slice(0, SUMMARY_MAX) + "…" : text;
}

export async function fetchRss(source: Source): Promise<FetchedItem[]> {
  if (!source.feed_url) {
    throw new Error(`feed_url がありません: ${source.id}`);
  }
  const feed = await parser.parseURL(source.feed_url);
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
  return items;
}
