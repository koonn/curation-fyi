import Parser from "rss-parser";
import type { Source } from "@curation-fyi/shared";
import { normalizeUrl } from "../normalize.ts";
import { toSummary } from "./rss.ts";
import type { FetchedItem } from "./types.ts";

const DEFAULT_MAX_RESULTS = 50;

/**
 * カテゴリはソースごとに違う（cs / stat / econ）ので data/sources.yaml の arxiv.categories から組む。
 * 検索式は `cat:X OR cat:Y`。arXiv API は短時間の連打に 429 "Rate exceeded." を返すため、
 * 複数の arXiv ソースを並べるときは collect の逐次実行に任せる（並列化しない）。
 */
function endpointFor(source: Source): string {
  const categories = source.arxiv?.categories ?? [];
  if (categories.length === 0) throw new Error(`arxiv.categories が空: ${source.id}`);
  const query = categories.map((c) => `cat:${c}`).join("+OR+");
  const max = source.arxiv?.max_results ?? DEFAULT_MAX_RESULTS;
  return `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${max}`;
}

const parser = new Parser({
  timeout: 20_000,
  headers: { "User-Agent": "curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)" },
});

// entry.id は http://arxiv.org/abs/2608.07446v1 形式。改版で記事が重複しないようバージョン接尾辞を除去する。
function extractArxivId(entryId: string): string | null {
  const m = entryId.match(/abs\/([^/]+?)(?:v\d+)?$/);
  return m?.[1] ?? null;
}

/**
 * arXiv は短時間の連打に 429 "Rate exceeded." を返す。ソースを3本に増やしたことで
 * 同一 collect 内の問い合わせが連続するため、モジュール内で最低3秒の間隔を空ける
 * （arXiv API の利用条件が求める間隔）。
 */
const MIN_INTERVAL_MS = 3_000;
let lastRequestAt = 0;

async function waitForSlot(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

export async function fetchArxiv(source: Source): Promise<FetchedItem[]> {
  await waitForSlot();
  const feed = await parser.parseURL(endpointFor(source));
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
