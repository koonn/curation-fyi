import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { articlesIn, loadSourceMap } from "../lib/load-articles";

export function GET(context: APIContext) {
  const sourceMap = loadSourceMap();
  // トップページと同じ範囲（企業・個人ブログ）にする。Social と論文は量も性質も違うため混ぜない
  const articles = articlesIn("tech").slice(0, 50);

  return rss({
    title: "curation.fyi",
    description: "Tech企業ブログ・個人ブログの新着記事",
    site: context.site ?? "https://curation-fyi.pages.dev",
    items: articles.map((a) => ({
      title: a.title,
      link: a.url,
      pubDate: new Date(a.published_at),
      description: a.summary ?? undefined,
      categories: [sourceMap.get(a.source_id)?.name ?? a.source_id],
    })),
  });
}
