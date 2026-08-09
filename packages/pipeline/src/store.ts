import fs from "node:fs";
import path from "node:path";
import type { Article } from "@curation-fyi/shared";
import { ARTICLES_DIR } from "./paths.ts";

/** 既存の全記事を url -> Article で返す */
export function loadExisting(): Map<string, Article> {
  const map = new Map<string, Article>();
  if (!fs.existsSync(ARTICLES_DIR)) return map;
  const files = fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  for (const file of files) {
    const lines = fs
      .readFileSync(path.join(ARTICLES_DIR, file), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    for (const line of lines) {
      const article = JSON.parse(line) as Article;
      map.set(article.url, article);
    }
  }
  return map;
}

/** published_at の月ごとのシャードに追記する */
export function appendArticles(articles: Article[]): void {
  if (articles.length === 0) return;
  fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  const byMonth = new Map<string, Article[]>();
  for (const a of articles) {
    const month = a.published_at.slice(0, 7); // YYYY-MM
    const list = byMonth.get(month) ?? [];
    list.push(a);
    byMonth.set(month, list);
  }
  for (const [month, list] of byMonth) {
    const file = path.join(ARTICLES_DIR, `${month}.jsonl`);
    const body = list.map((a) => JSON.stringify(a)).join("\n") + "\n";
    fs.appendFileSync(file, body);
  }
}
