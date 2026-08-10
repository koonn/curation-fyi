import Parser from "rss-parser";
import type { Source } from "@curation-fyi/shared";
import { normalizeUrl } from "../normalize.ts";
import { toSummary } from "./rss.ts";
import type { FetchedItem } from "./types.ts";

const ENDPOINT =
  "https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL+OR+cat:cs.SE&sortBy=submittedDate&sortOrder=descending&max_results=50";

const parser = new Parser({
  timeout: 20_000,
  headers: { "User-Agent": "curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)" },
});

// entry.id は http://arxiv.org/abs/2608.07446v1 形式。改版で記事が重複しないようバージョン接尾辞を除去する。
function extractArxivId(entryId: string): string | null {
  const m = entryId.match(/abs\/([^/]+?)(?:v\d+)?$/);
  return m?.[1] ?? null;
}

export async function fetchArxiv(source: Source): Promise<FetchedItem[]> {
  const feed = await parser.parseURL(ENDPOINT);
  const items: FetchedItem[] = [];
  for (const entry of feed.items) {
    if (!entry.id || !entry.title || !entry.isoDate) continue;
    const arxivId = extractArxivId(entry.id);
    if (!arxivId) continue;
    items.push({
      url: normalizeUrl(`https://arxiv.org/abs/${arxivId}`),
      title: entry.title.replace(/\s+/g, " ").trim(),
      summary: toSummary(entry.summary),
      published_at: entry.isoDate,
      language: "en",
      external_ids: { arxiv_id: arxivId },
    });
  }
  return items;
}
