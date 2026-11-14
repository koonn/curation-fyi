import type { KaggleConfig, Source } from "@curation-fyi/shared";
import { normalizeUrl } from "../normalize.ts";
import type { FetchedItem } from "./types.ts";

/**
 * Kaggle 公式 API（api.kaggle.com/v1、Bearer 認証）から収集する。
 * 形は公式 CLI（kaggle 2.2.5）の SDK と、実サーバーへの生の HTTP で確かめた（2026-11-14）。
 *
 * - **blog**: Kaggle Blog に RSS は無い（Medium の旧フィードは 2020-09 で停止、/blog は JS 描画）。
 *   検索 API に documentTypes:["BLOG"] を渡すと 400 "Unsupported document types: [Blog]"。
 *   Blog は内部で Writeup として扱われており、**TOPIC 型を writeUpTypes:["BLOG"] で絞ると取れる**
 * - **writeups / discussions**: ListTopics の HOT。検索 API の HOTNESS は「累計の人気」
 *   （2018年の入門 Exercise が上位に来る）で、「いま伸びている」はこちらでしか取れない。
 *   pageSize を 50 にしても 20件で打ち切られ、HOT に次ページは無い
 */

const ENDPOINT = "https://api.kaggle.com/v1";
const SITE = "https://www.kaggle.com";
const USER_AGENT = "curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)";
const TIMEOUT_MS = 20_000;
const TOKEN_ENV = "KAGGLE_API_TOKEN";

async function call(service: string, body: unknown): Promise<unknown> {
  const token = process.env[TOKEN_ENV];
  if (!token) throw new Error(`${TOKEN_ENV} が未設定`);
  const res = await fetch(`${ENDPOINT}/${service}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // 本文に理由が入る（例: {"error":{"message":"Unsupported document types: [Blog]"}}）
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Kaggle API エラー: ${res.status} ${service} ${detail}`);
  }
  return res.json();
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** API が返すサイト内パス（/blog/<slug>#<commentId> 等）を記事URLにする。# 以降は normalizeUrl が落とす */
function toUrl(path: string): string {
  return normalizeUrl(new URL(path, SITE).toString());
}

interface BlogDocument {
  title?: unknown;
  createTime?: unknown;
  discussionDocument?: {
    newCommentUrl?: unknown;
    writeUpMetadata?: { subtitle?: unknown };
  };
}

async function fetchBlog(): Promise<FetchedItem[]> {
  const data = (await call("search.SearchApiService/ListEntities", {
    pageSize: 50,
    canonicalOrderBy: "LIST_SEARCH_CONTENT_ORDER_BY_DATE_CREATED",
    filters: {
      query: "",
      documentTypes: ["TOPIC"],
      discussionFilters: {
        writeUpInclusionType: "WRITE_UP_INCLUSION_TYPE_ONLY",
        writeUpTypes: ["BLOG"],
      },
    },
  })) as { documents?: BlogDocument[] };
  const items: FetchedItem[] = [];
  for (const d of data.documents ?? []) {
    const title = str(d.title);
    const path = str(d.discussionDocument?.newCommentUrl);
    const published = str(d.createTime);
    if (!title || !path || !published) continue;
    items.push({
      url: toUrl(path),
      title,
      summary: str(d.discussionDocument?.writeUpMetadata?.subtitle),
      published_at: published,
      language: "en",
    });
  }
  return items;
}

interface Topic {
  title?: unknown;
  url?: unknown;
  postDate?: unknown;
  votes?: unknown;
}

async function fetchTopics(config: KaggleConfig): Promise<FetchedItem[]> {
  const body: Record<string, unknown> = { sortBy: "TOPIC_LIST_SORT_BY_HOT", pageSize: 20 };
  if (config.feed === "writeups") body.category = "TOPIC_LIST_CATEGORY_COMPETITION_WRITE_UPS";
  const data = (await call("discussions.DiscussionApiService/ListTopics", body)) as { topics?: Topic[] };
  const minVotes = config.min_votes ?? 0;
  const items: FetchedItem[] = [];
  for (const t of data.topics ?? []) {
    const title = str(t.title);
    const path = str(t.url);
    const published = str(t.postDate);
    if (!title || !path || !published) continue;
    // votes は 0 のとき項目ごと省かれる（commentCount も同様。実測）
    const votes = typeof t.votes === "number" ? t.votes : 0;
    if (votes < minVotes) continue;
    items.push({
      url: toUrl(path),
      title,
      summary: null,
      published_at: published,
      language: "en",
    });
  }
  return items;
}

export async function fetchKaggle(source: Source): Promise<FetchedItem[]> {
  const config = source.kaggle;
  if (!config) throw new Error(`kaggle 設定が無い: ${source.id}`);
  switch (config.feed) {
    case "blog":
      return fetchBlog();
    case "writeups":
    case "discussions":
      return fetchTopics(config);
    default:
      throw new Error(`未対応の kaggle.feed: ${String((config as { feed: unknown }).feed)} (${source.id})`);
  }
}
