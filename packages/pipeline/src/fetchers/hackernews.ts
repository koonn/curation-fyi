import type { Source } from "@curation-fyi/shared";
import { normalizeUrl } from "../normalize.ts";
import type { FetchedItem } from "./types.ts";

const ENDPOINT = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50";

interface HnHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number;
  num_comments: number;
  created_at: string;
}

interface HnResponse {
  hits: HnHit[];
}

export async function fetchHackernews(source: Source): Promise<FetchedItem[]> {
  const res = await fetch(ENDPOINT, {
    headers: { "User-Agent": "curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)" },
  });
  if (!res.ok) {
    throw new Error(`HN API エラー: ${res.status} (${source.id})`);
  }
  const data = (await res.json()) as HnResponse;
  const items: FetchedItem[] = [];
  for (const hit of data.hits) {
    if (!hit.url || !hit.title) continue; // Ask HN等の自サイト内投稿は対象外
    items.push({
      url: normalizeUrl(hit.url),
      title: hit.title.trim(),
      summary: null,
      published_at: hit.created_at,
      language: "en",
      external_ids: { hn_id: Number(hit.objectID) },
      metrics: { hn_points: hit.points, hn_comments: hit.num_comments },
    });
  }
  return items;
}
