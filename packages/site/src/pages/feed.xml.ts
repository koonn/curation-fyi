import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { loadArticles, loadSourceMap } from "../lib/load-articles";

export function GET(context: APIContext) {
  const sourceMap = loadSourceMap();
  const articles = loadArticles().slice(0, 50);

  return rss({
    title: "curation.fyi",
    description: "Tech企業ブログ・個人ブログ・話題の記事を日英横断でまとめるキュレーションサイト",
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
