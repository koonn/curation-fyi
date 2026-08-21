import type { Source } from "@curation-fyi/shared";
import { loadAllSources } from "./sources.ts";
import { loadExisting, saveAll } from "./store.ts";
import { loadTaxonomy, ruleTags } from "./tagger/rules.ts";

/**
 * 全記事の tags をルールベースで再計算して上書きする。
 * resetLlm を立てると llm_tagged_at を全件から消し、LLM が「該当タグなし」と
 * 確定させた記事を再び候補に戻す（taxonomy にタグを足したときに使う）。
 */
export function retag(resetLlm = false): void {
  const taxonomy = loadTaxonomy();
  const sourceById = new Map<string, Source>(loadAllSources().map((s) => [s.id, s]));
  const existing = loadExisting();

  let tagged = 0;
  let reset = 0;
  for (const article of existing.values()) {
    article.tags = ruleTags(article, sourceById.get(article.source_id), taxonomy);
    if (article.tags.length > 0) tagged++;
    if (resetLlm && article.llm_tagged_at !== undefined) {
      delete article.llm_tagged_at;
      reset++;
    }
  }
  saveAll(existing.values());

  const total = existing.size;
  const rate = total === 0 ? 0 : tagged / total;
  console.log(
    `retag: ${total} 件中 ${tagged} 件にタグ付与 (${(rate * 100).toFixed(1)}%)` +
      (resetLlm ? `、llm_tagged_at を ${reset} 件から削除（次回の collect で再判定される）` : ""),
  );
}
