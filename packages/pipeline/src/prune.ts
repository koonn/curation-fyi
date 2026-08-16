import type { Article, Source } from "@curation-fyi/shared";
import { loadAllSources } from "./sources.ts";
import { loadExisting, rewriteMonths } from "./store.ts";
import { isExcluded } from "./exclude.ts";

/**
 * sources.yaml の exclude 条件にあたる既存記事を削除する。
 * exclude を足しただけでは既に取り込んだ分が残るため、これで揃える。
 * --dry-run では件数だけ出して何も書き込まない。
 */
export function prune(dryRun: boolean): void {
  const sourceById = new Map<string, Source>(loadAllSources().map((s) => [s.id, s]));
  const existing = loadExisting();

  const doomed: Article[] = [];
  for (const article of existing.values()) {
    if (isExcluded(sourceById.get(article.source_id), article)) doomed.push(article);
  }

  const bySource = new Map<string, number>();
  const months = new Set<string>();
  for (const a of doomed) {
    bySource.set(a.source_id, (bySource.get(a.source_id) ?? 0) + 1);
    months.add(a.published_at.slice(0, 7));
  }

  console.log(`prune: 削除対象 ${doomed.length} 件 / 既存 ${existing.size} 件（影響する月 ${months.size} 個）`);
  for (const [id, n] of [...bySource].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${id}: ${n} 件`);
  }
  if (dryRun) {
    console.log("prune: --dry-run のため何も書き込んでいない");
    return;
  }
  if (doomed.length === 0) return;

  for (const a of doomed) existing.delete(a.url);
  rewriteMonths(existing.values(), months);
  console.log(`prune: 削除完了。残り ${existing.size} 件`);
}
