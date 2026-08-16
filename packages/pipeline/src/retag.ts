import type { Source } from "@curation-fyi/shared";
import { loadAllSources } from "./sources.ts";
import { loadExisting, saveAll } from "./store.ts";
import { loadTaxonomy, ruleTags } from "./tagger/rules.ts";

/** 全記事の tags をルールベースで再計算して上書きする */
export function retag(): void {
  const taxonomy = loadTaxonomy();
  const sourceById = new Map<string, Source>(loadAllSources().map((s) => [s.id, s]));
  const existing = loadExisting();

  let tagged = 0;
  for (const article of existing.values()) {
    article.tags = ruleTags(article, sourceById.get(article.source_id), taxonomy);
    if (article.tags.length > 0) tagged++;
  }
  saveAll(existing.values());

  const total = existing.size;
  const rate = total === 0 ? 0 : tagged / total;
  console.log(`retag: ${total} 件中 ${tagged} 件にタグ付与 (${(rate * 100).toFixed(1)}%)`);
}
