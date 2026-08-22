import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { articlesIn, displaySummaryLines, displayTitle, loadSourceMap } from "../lib/load-articles";

export function GET(context: APIContext) {
  const sourceMap = loadSourceMap();
  // トップページと同じ範囲（企業・個人ブログ）にする。Social と論文は量も性質も違うため混ぜない
  const articles = articlesIn("tech").slice(0, 50);

  return rss({
    title: "curation.fyi",
    description: "Tech企業ブログ・個人ブログの新着記事",
    site: context.site ?? "https://curation-fyi.pages.dev",
    items: articles.map((a) => ({
      // 和訳があれば和訳を見出しにする（サイトの表示と揃える）
      title: displayTitle(a).main,
      link: a.url,
      pubDate: new Date(a.published_at),
      description: displaySummaryLines(a).join(" ") || a.summary || undefined,
      categories: [sourceMap.get(a.source_id)?.name ?? a.source_id],
    })),
  });
}
