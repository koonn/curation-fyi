import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { CATEGORIES, categoryOf, type Article, type Category, type Source, type Tag } from "@curation-fyi/shared";

export { CATEGORIES, type Category };

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const ARTICLES_DIR = path.join(REPO_ROOT, "data", "articles");
const SOURCES_FILE = path.join(REPO_ROOT, "data", "sources.yaml");
const TAXONOMY_FILE = path.join(REPO_ROOT, "taxonomy", "tags.yaml");

/** 1ページの件数 */
export const PAGE_SIZE = 20;

/** そのカテゴリに属するソースの type か */
export function inCategory(
  article: Article,
  sourceMap: Map<string, Source>,
  category: Category,
): boolean {
  return categoryOf(sourceMap.get(article.source_id)?.type) === category;
}

/** カテゴリで絞った記事（published_at 降順のまま） */
export function articlesIn(category: Category): Article[] {
  const sourceMap = loadSourceMap();
  return loadArticles().filter((a) => inCategory(a, sourceMap, category));
}

/** 全記事を published_at 降順で返す */
export function loadArticles(): Article[] {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  const articles: Article[] = [];
  for (const file of fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".jsonl"))) {
    const lines = fs
      .readFileSync(path.join(ARTICLES_DIR, file), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    for (const line of lines) {
      articles.push(JSON.parse(line) as Article);
    }
  }
  articles.sort((a, b) => b.published_at.localeCompare(a.published_at));
  return articles;
}

function loadSourceList(): Source[] {
  return parse(fs.readFileSync(SOURCES_FILE, "utf8")) as Source[];
}

/** 無効化済みを含む全ソース。既存記事のソース名を引くために使う */
export function loadSourceMap(): Map<string, Source> {
  return new Map(loadSourceList().map((s) => [s.id, s]));
}

/** 収集対象のソースのみ */
export function loadEnabledSources(): Source[] {
  return loadSourceList().filter((s) => s.enabled);
}

export function loadTagMap(): Map<string, Tag> {
  const tags = parse(fs.readFileSync(TAXONOMY_FILE, "utf8")) as Tag[];
  return new Map(tags.map((t) => [t.slug, t]));
}

/** 表示用タグ。ルールベースとLLM/手動のタグを合わせたもの */
export function displayTags(article: Article): string[] {
  return [...new Set([...article.tags, ...(article.llm_tags ?? [])])];
}

/**
 * 表示用の見出し。和訳があれば和訳を主・原題を副にする。
 * 和訳を持たない記事（日本語記事・未処理の英語記事）は sub が null になり、
 * 呼び出し側は原題だけを従来どおり出す
 */
export function displayTitle(article: Article): { main: string; sub: string | null } {
  return article.title_ja
    ? { main: article.title_ja, sub: article.title }
    : { main: article.title, sub: null };
}

/** 表示用の3行サマリ。無い記事は空配列（呼び出し側はフィード由来の summary に落とす） */
export function displaySummaryLines(article: Article): string[] {
  return article.summary_ja ?? [];
}

/** 直近7日の盛り上がりスコア。metrics が無ければ 0 */
export function score(article: Article): number {
  return (article.metrics.hn_points ?? 0) + (article.metrics.hatebu_count ?? 0);
}

/** 1始まりのページ番号で分割する。空配列でも1ページ返す（空ページを出すため） */
export function paginate<T>(items: T[], pageSize = PAGE_SIZE): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }
  return pages;
}

/** getStaticPaths 用に「ページ番号 → その頁の記事」の組を作る */
export function pageEntries<T>(items: T[], pageSize = PAGE_SIZE): { page: string; items: T[]; total: number }[] {
  const pages = paginate(items, pageSize);
  return pages.map((items, i) => ({ page: String(i + 1), items, total: pages.length }));
}
