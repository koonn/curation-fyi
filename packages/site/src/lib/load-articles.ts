import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { Article, Source } from "@curation-fyi/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const ARTICLES_DIR = path.join(REPO_ROOT, "data", "articles");
const SOURCES_FILE = path.join(REPO_ROOT, "data", "sources.yaml");

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

export function loadSourceMap(): Map<string, Source> {
  const sources = parse(fs.readFileSync(SOURCES_FILE, "utf8")) as Source[];
  return new Map(sources.map((s) => [s.id, s]));
}
