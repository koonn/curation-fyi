import type { Source } from "@curation-fyi/shared";

/**
 * ソースの exclude 条件にあたるか。
 * 収集時（新規記事の取り込み）と prune（既存記事の削除）で同じ判定を使う。
 */
export function isExcluded(source: Source | undefined, item: { url: string; title: string }): boolean {
  const rules = source?.exclude;
  if (!rules) return false;
  for (const needle of rules.url_contains ?? []) {
    if (item.url.includes(needle)) return true;
  }
  for (const pattern of rules.title_matches ?? []) {
    if (new RegExp(pattern, "i").test(item.title)) return true;
  }
  return false;
}
