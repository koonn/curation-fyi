export type SourceType =
  | "company_blog"
  | "personal_blog"
  | "aggregator"
  | "paper"
  | "tweet";

export type Language = "en" | "ja";

/**
 * 記事の分類。ソースの type で切る。site のページ分割と pipeline のタグ付け対象の
 * 両方がこれを使うので、片方だけずれないよう shared に置く。
 */
export const CATEGORIES = {
  tech: { label: "Tech", types: ["company_blog", "personal_blog", "tweet"] },
  social: { label: "Social", types: ["aggregator"] },
  papers: { label: "論文", types: ["paper"] },
} as const;

export type Category = keyof typeof CATEGORIES;

export function categoryOf(type: string | undefined): Category | undefined {
  if (!type) return undefined;
  for (const [key, def] of Object.entries(CATEGORIES)) {
    if ((def.types as readonly string[]).includes(type)) return key as Category;
  }
  return undefined;
}

export type FetcherKind =
  | "rss"
  | "hn_api"
  | "arxiv_api"
  | "hatena_hotentry"
  | `custom:${string}`;

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  /** フィード全体の既定言語。mixed のときは記事ごとに判定する */
  language: Language | "mixed";
  site_url: string;
  feed_url?: string;
  fetcher: FetcherKind;
  default_tags?: string[];
  /** 収集対象から外す条件。製品告知など、キュレーションの対象外を弾く */
  exclude?: SourceExclude;
  enabled: boolean;
}

export interface SourceExclude {
  /** URL にこの文字列を含むものを除外する */
  url_contains?: string[];
  /** タイトルがこの正規表現にマッチするものを除外する（大文字小文字は無視） */
  title_matches?: string[];
}

/** taxonomy/tags.yaml の 1 エントリ */
export interface Tag {
  slug: string;
  name: string;
  /** 単語境界マッチ（大文字小文字無視） */
  keywords_en: string[];
  /** 部分文字列マッチ */
  keywords_ja: string[];
}

export interface ExternalIds {
  hn_id?: number;
  arxiv_id?: string;
  hatena_eid?: string;
  tweet_id?: string;
}

export interface Metrics {
  hn_points?: number;
  hn_comments?: number;
  hatebu_count?: number;
}

export interface Article {
  id: string;
  /** 正規化済み canonical URL。全記事を通じた重複排除キー */
  url: string;
  title: string;
  summary: string | null;
  published_at: string;
  fetched_at: string;
  language: Language;
  source_id: string;
  /** taxonomy/tags.yaml のキーワードマッチで付いたタグ */
  tags: string[];
  /** LLM が付けたタグ（tags が空の記事にのみ付く）。表示は union(tags, llm_tags) */
  llm_tags: string[];
  has_code: boolean | null;
  external_ids: ExternalIds;
  metrics: Metrics;
}
