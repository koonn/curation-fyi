import type { ExternalIds, Language, Metrics } from "@curation-fyi/shared";

/** 全fetcherの戻り値型として共通化する。external_ids/metricsはaggregator系のみ設定する。 */
export interface FetchedItem {
  url: string;
  title: string;
  summary: string | null;
  published_at: string;
  language: Language;
  external_ids?: ExternalIds;
  metrics?: Metrics;
}
