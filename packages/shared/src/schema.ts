export type SourceType =
  | "company_blog"
  | "personal_blog"
  | "aggregator"
  /** 編集を経た技術誌（ACM Queue 等）。査読プレプリントの paper とは別に扱う */
  | "magazine"
  | "paper"
  | "tweet";

export type Language = "en" | "ja";

/**
 * 記事の分類。ソースの type で切る。site のページ分割と pipeline のタグ付け対象の
 * 両方がこれを使うので、片方だけずれないよう shared に置く。
 */
export const CATEGORIES = {
  tech: { label: "Tech", types: ["company_blog", "personal_blog", "magazine", "tweet"] },
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
  /** fetcher: custom:html_list のときの設定 */
  html_list?: HtmlListConfig;
  /**
   * URLのフラグメント（#以降）を重複排除キーに残す。既定は除去。
   * 1ページの中を #anchor で区切って各記事を指すフィード（Anthropic の release notes 等）だけ true にする。
   */
  keep_url_fragment?: boolean;
  enabled: boolean;
}

/**
 * RSS/Atom を持たないサイトを一覧ページのHTMLから収集するときの設定。
 * 一覧から URL と公開日を、記事ページから og:title / og:description を取る。
 */
export interface HtmlListConfig {
  /** 一覧ページ。省略時は site_url */
  list_url?: string;
  /** href がこの正規表現にマッチするものを記事とみなす */
  link_pattern: string;
  /** 記事ページのタイトルから落とす定型（サイト名の接頭・接尾）の正規表現 */
  title_strip?: string;
  /** 一覧に日付が無く slug に YYMMDD が埋まっている形式（DeepSeek）。3つのキャプチャが YY/MM/DD */
  date_from_slug?: string;
  /** 1回の収集で見る上限（既定40） */
  max_items?: number;
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
  /**
   * LLM がこの記事を判定した時刻（ISO）。未判定なら undefined。
   * llm_tags: [] は記事の生成時に全件へ書かれる既定値なので、
   * 「LLMが見てタグなしと判断した」と「一度も見ていない」を区別できない。
   * これが無いと却下済みの記事が毎回候補に戻り、無料枠を再判定で食い潰す。
   * taxonomy を増やして再判定したくなったら `retag --llm-reset` で消す。
   */
  llm_tagged_at?: string;
  /**
   * LLM が生成した和訳見出し（英語記事のみ）。未生成なら undefined。
   * **この有無がそのまま「和訳ジョブが処理したか」のフラグを兼ねる。**
   * llm_tagged_at のような別フラグが要らないのは、和訳見出しが正当に空になることが
   * ないため（タグは「該当なし」が正当な結果で、既定値の [] と区別できなかった）。
   */
  title_ja?: string;
  /**
   * LLM が生成した3行サマリ（日本語）。未生成なら undefined。
   * 本文が取れずタイトルしか無い等で3行を作らないと判断した場合は [] を入れる
   * （title_ja が入っていれば処理済みなので、[] でも再処理されない）。
   */
  summary_ja?: string[];
  has_code: boolean | null;
  external_ids: ExternalIds;
  metrics: Metrics;
}
