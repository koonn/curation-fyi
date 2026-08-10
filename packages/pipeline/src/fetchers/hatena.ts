import Parser from "rss-parser";
import type { Source } from "@curation-fyi/shared";
import { normalizeUrl } from "../normalize.ts";
import { toSummary } from "./rss.ts";
import type { FetchedItem } from "./types.ts";

const parser = new Parser({
  timeout: 20_000,
  headers: { "User-Agent": "curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)" },
  customFields: {
    item: [
      ["hatena:bookmarkcount", "bookmarkCount"],
      ["dc:date", "dcDate"],
    ],
  },
});

interface HatenaItem {
  link?: string;
  title?: string;
  contentSnippet?: string;
  bookmarkCount?: string;
  dcDate?: string;
}

export async function fetchHatena(source: Source): Promise<FetchedItem[]> {
  if (!source.feed_url) {
    throw new Error(`feed_url がありません: ${source.id}`);
  }
  const feed = await parser.parseURL(source.feed_url);
  const items: FetchedItem[] = [];
  for (const item of feed.items as HatenaItem[]) {
    if (!item.link || !item.title || !item.dcDate) continue;
    const bookmarkCount = Number(item.bookmarkCount);
    items.push({
      url: normalizeUrl(item.link),
      title: item.title.trim(),
      summary: toSummary(item.contentSnippet),
      published_at: item.dcDate,
      language: "ja",
      external_ids: {},
      metrics: Number.isFinite(bookmarkCount) ? { hatebu_count: bookmarkCount } : undefined,
    });
  }
  return items;
}
