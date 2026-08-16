import fs from "node:fs";
import { parse } from "yaml";
import type { Article, Source, Tag } from "@curation-fyi/shared";
import { TAXONOMY_FILE } from "../paths.ts";

export function loadTaxonomy(): Tag[] {
  const raw = parse(fs.readFileSync(TAXONOMY_FILE, "utf8")) as Tag[];
  const seen = new Set<string>();
  for (const t of raw) {
    if (!t.slug || !t.name) {
      throw new Error(`tags.yaml: 必須フィールド欠落: ${JSON.stringify(t)}`);
    }
    if (seen.has(t.slug)) {
      throw new Error(`tags.yaml: slug重複: ${t.slug}`);
    }
    seen.add(t.slug);
  }
  return raw;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matches(tag: Tag, text: string): boolean {
  for (const kw of tag.keywords_en ?? []) {
    if (new RegExp("\\b" + escapeRegExp(kw) + "\\b", "i").test(text)) return true;
  }
  for (const kw of tag.keywords_ja ?? []) {
    if (text.includes(kw)) return true;
  }
  return false;
}

/**
 * ルールベースのタグ付け。返り値は taxonomy 記載順（taxonomy に無い default_tags はその後ろ）。
 * source が未知（無効化済みソース等）の場合は本文マッチのみで判定する。
 */
export function ruleTags(article: Article, source: Source | undefined, taxonomy: Tag[]): string[] {
  const text = article.title + " " + (article.summary ?? "");
  const hit = new Set<string>();
  for (const tag of taxonomy) {
    if (matches(tag, text)) hit.add(tag.slug);
  }
  // 特例: paper ソースの記事には無条件で paper タグを付ける
  if (source?.type === "paper") hit.add("paper");
  for (const slug of source?.default_tags ?? []) hit.add(slug);

  const known = taxonomy.filter((t) => hit.has(t.slug)).map((t) => t.slug);
  const extra = [...hit].filter((slug) => !taxonomy.some((t) => t.slug === slug));
  return [...known, ...extra];
}
