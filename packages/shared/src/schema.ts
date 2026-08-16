export type SourceType =
  | "company_blog"
  | "personal_blog"
  | "aggregator"
  | "paper"
  | "tweet";

export type Language = "en" | "ja";

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
  enabled: boolean;
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
  tags: string[];
  has_code: boolean | null;
  external_ids: ExternalIds;
  metrics: Metrics;
}
