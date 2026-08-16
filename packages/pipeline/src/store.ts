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
      article.llm_tags ??= []; // B-2以前のデータ互換。次回 saveAll で永続化される
      map.set(article.url, article);
    }
  }
  return map;
}

/**
 * 渡された記事を published_at の月（YYYY-MM）でグループ化し、該当月のファイルを全量書き直す（追記ではない）。
 * 呼び出し側は変更のあった月に属する記事全件を渡すこと（一部だけ渡すとその月のファイルから記事が失われる）。
 */
export function saveAll(articles: Iterable<Article>): void {
  const byMonth = new Map<string, Article[]>();
  for (const a of articles) {
    const month = a.published_at.slice(0, 7); // YYYY-MM
    const list = byMonth.get(month) ?? [];
    list.push(a);
    byMonth.set(month, list);
  }
  if (byMonth.size === 0) return;
  writeMonths(byMonth);
}

/**
 * 指定した月のファイルを、残った記事だけで書き直す（削除に使う）。
 * その月の記事が0件になったらファイルごと消す。
 */
export function rewriteMonths(remaining: Iterable<Article>, months: Set<string>): void {
  if (months.size === 0) return;
  const byMonth = new Map<string, Article[]>();
  for (const month of months) byMonth.set(month, []);
  for (const a of remaining) {
    const list = byMonth.get(a.published_at.slice(0, 7));
    if (list) list.push(a);
  }
  writeMonths(byMonth);
}

function writeMonths(byMonth: Map<string, Article[]>): void {
  fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  for (const [month, list] of byMonth) {
    const file = path.join(ARTICLES_DIR, `${month}.jsonl`);
    if (list.length === 0) {
      fs.rmSync(file, { force: true });
      continue;
    }
    list.sort((a, b) => {
      if (a.published_at !== b.published_at) {
        return a.published_at < b.published_at ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const body = list.map((a) => JSON.stringify(a)).join("\n") + "\n";
    fs.writeFileSync(file, body);
  }
}
