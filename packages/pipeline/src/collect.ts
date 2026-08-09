import { ulid } from "ulid";
import type { Article, Source } from "@curation-fyi/shared";
import { loadSources } from "./sources.ts";
import { fetchRss } from "./fetchers/rss.ts";
import { loadExisting, appendArticles } from "./store.ts";

interface SourceResult {
  source: Source;
  added: number;
  skipped: number;
  error?: Error;
}

async function collectSource(
  source: Source,
  existing: Map<string, Article>,
  fetchedAt: string,
): Promise<{ articles: Article[]; skipped: number }> {
  if (source.fetcher !== "rss") {
    throw new Error(`未対応のfetcher: ${source.fetcher} (${source.id})`);
  }
  const items = await fetchRss(source);
  const articles: Article[] = [];
  const seenInFeed = new Set<string>(); // 同一フィード内の同一URL（更新entry等）を弾く
  let skipped = 0;
  for (const item of items) {
    if (existing.has(item.url) || seenInFeed.has(item.url)) {
      skipped++;
      continue;
    }
    seenInFeed.add(item.url);
    articles.push({
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
      external_ids: {},
      metrics: {},
    });
  }
  return { articles, skipped };
}

export async function collect(): Promise<void> {
  const sources = loadSources();
  const existing = loadExisting();
  const fetchedAt = new Date().toISOString();
  console.log(`ソース ${sources.length} 件、既存記事 ${existing.size} 件`);

  const results: SourceResult[] = [];
  const newArticles: Article[] = [];

  for (const source of sources) {
    try {
      const { articles, skipped } = await collectSource(source, existing, fetchedAt);
      // 同一実行内の別ソースとの重複も防ぐため existing に反映してから蓄積する
      for (const a of articles) existing.set(a.url, a);
      newArticles.push(...articles);
      results.push({ source, added: articles.length, skipped });
    } catch (e) {
      results.push({
        source,
        added: 0,
        skipped: 0,
        error: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  appendArticles(newArticles);

  for (const r of results) {
    if (r.error) {
      console.error(`✗ ${r.source.id}: ${r.error.message}`);
    } else {
      console.log(`✓ ${r.source.id}: 新規 ${r.added} 件 / 既存スキップ ${r.skipped} 件`);
    }
  }
  const failed = results.filter((r) => r.error).length;
  console.log(`合計: 新規 ${newArticles.length} 件追加、失敗ソース ${failed}/${results.length}`);

  if (failed === results.length && results.length > 0) {
    process.exitCode = 1; // 全滅のときだけ失敗にする（部分失敗は運用で拾う）
  }
}
