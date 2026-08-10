import { ulid } from "ulid";
import type { Article, Source } from "@curation-fyi/shared";
import { loadSources } from "./sources.ts";
import { fetchRss } from "./fetchers/rss.ts";
import { fetchHackernews } from "./fetchers/hackernews.ts";
import { fetchHatena } from "./fetchers/hatena.ts";
import { fetchArxiv } from "./fetchers/arxiv.ts";
import type { FetchedItem } from "./fetchers/types.ts";
import { loadExisting, saveAll } from "./store.ts";

async function fetchItems(source: Source): Promise<FetchedItem[]> {
  switch (source.fetcher) {
    case "rss":
      return fetchRss(source);
    case "hn_api":
      return fetchHackernews(source);
    case "hatena_hotentry":
      return fetchHatena(source);
    case "arxiv_api":
      return fetchArxiv(source);
    default:
      throw new Error(`未対応のfetcher: ${source.fetcher} (${source.id})`);
  }
}

interface SourceResult {
  source: Source;
  added: number;
  merged: number;
  skipped: number;
  error?: Error;
}

async function collectSource(
  source: Source,
  existing: Map<string, Article>,
  fetchedAt: string,
  changedMonths: Set<string>,
): Promise<{ added: number; merged: number; skipped: number }> {
  const items = await fetchItems(source);
  const seenInFeed = new Set<string>(); // 同一フィード内の同一URL（更新entry等）を弾く
  let added = 0;
  let merged = 0;
  let skipped = 0;
  for (const item of items) {
    if (seenInFeed.has(item.url)) {
      skipped++;
      continue;
    }
    seenInFeed.add(item.url);

    const current = existing.get(item.url);
    if (!current) {
      const article: Article = {
        id: ulid(),
        url: item.url,
        title: item.title,
        summary: item.summary,
        published_at: item.published_at,
        fetched_at: fetchedAt,
        language: item.language,
        source_id: source.id,
        tags: source.default_tags ?? [],
        has_code: null,
        external_ids: item.external_ids ?? {},
        metrics: item.metrics ?? {},
      };
      existing.set(article.url, article);
      changedMonths.add(article.published_at.slice(0, 7));
      added++;
    } else if (item.metrics) {
      // 既存記事に aggregator の metrics をマージする。title/summary/published_at/source_id は変更しない。
      current.metrics = { ...current.metrics, ...item.metrics };
      current.external_ids = { ...current.external_ids, ...item.external_ids };
      changedMonths.add(current.published_at.slice(0, 7));
      merged++;
    } else {
      skipped++;
    }
  }
  return { added, merged, skipped };
}

export async function collect(): Promise<void> {
  const sources = loadSources();
  const existing = loadExisting();
  const fetchedAt = new Date().toISOString();
  console.log(`ソース ${sources.length} 件、既存記事 ${existing.size} 件`);

  const results: SourceResult[] = [];
  const changedMonths = new Set<string>();
  let totalAdded = 0;

  for (const source of sources) {
    try {
      const { added, merged, skipped } = await collectSource(source, existing, fetchedAt, changedMonths);
      totalAdded += added;
      results.push({ source, added, merged, skipped });
    } catch (e) {
      results.push({
        source,
        added: 0,
        merged: 0,
        skipped: 0,
        error: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  // 変更のあった月に属する記事全件を集めて、その月のファイルだけ全量書き直す
  const toSave: Article[] = [];
  for (const article of existing.values()) {
    if (changedMonths.has(article.published_at.slice(0, 7))) {
      toSave.push(article);
    }
  }
  saveAll(toSave);

  for (const r of results) {
    if (r.error) {
      console.error(`✗ ${r.source.id}: ${r.error.message}`);
    } else {
      console.log(
        `✓ ${r.source.id}: 新規 ${r.added} 件 / metrics更新 ${r.merged} 件 / 既存スキップ ${r.skipped} 件`,
      );
    }
  }
  const failed = results.filter((r) => r.error).length;
  console.log(`合計: 新規 ${totalAdded} 件追加、失敗ソース ${failed}/${results.length}`);

  if (failed === results.length && results.length > 0) {
    process.exitCode = 1; // 全滅のときだけ失敗にする（部分失敗は運用で拾う）
  }
}
