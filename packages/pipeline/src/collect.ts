import fs from "node:fs";
import { ulid } from "ulid";
import { categoryOf, type Article, type Source } from "@curation-fyi/shared";
import { loadAllSources, loadSources } from "./sources.ts";
import { loadTaxonomy, ruleTags } from "./tagger/rules.ts";
import { tagWithLlm } from "./tagger/llm.ts";
import { translateCandidates, translateWithLlm } from "./translator/llm.ts";
import { isLlmEnabled, LlmRunner } from "./llm/gemini.ts";
import { isExcluded } from "./exclude.ts";
import { fetchRss } from "./fetchers/rss.ts";
import { fetchHackernews } from "./fetchers/hackernews.ts";
import { fetchHatena } from "./fetchers/hatena.ts";
import { fetchArxiv } from "./fetchers/arxiv.ts";
import { fetchHtmlList } from "./fetchers/htmlList.ts";
import type { FetchedItem } from "./fetchers/types.ts";
import { loadExisting, saveAll } from "./store.ts";
import { defaultSourceState, loadFeedState, saveFeedState, type SourceState } from "./state.ts";

const FAILURE_THRESHOLD = 7;

interface FetchOutcome {
  items: FetchedItem[];
  notModified: boolean;
  etag?: string | null;
  lastModified?: string | null;
}

async function fetchItems(
  source: Source,
  state: SourceState,
  known: { has(url: string): boolean },
): Promise<FetchOutcome> {
  switch (source.fetcher) {
    case "rss":
      return fetchRss(source, state);
    case "hn_api":
      return { items: await fetchHackernews(source), notModified: false };
    case "hatena_hotentry":
      return { items: await fetchHatena(source), notModified: false };
    case "arxiv_api":
      return { items: await fetchArxiv(source), notModified: false };
    case "custom:html_list":
      return fetchHtmlList(source, known);
    default:
      throw new Error(`未対応のfetcher: ${source.fetcher} (${source.id})`);
  }
}

interface SourceResult {
  source: Source;
  added: number;
  merged: number;
  skipped: number;
  excluded: number;
  /** 既存記事のうち、取り出しが直って要約を埋められた件数 */
  summaryFilled: number;
  notModified: boolean;
  error?: Error;
}

function mergeItems(
  items: FetchedItem[],
  source: Source,
  existing: Map<string, Article>,
  fetchedAt: string,
  changedMonths: Set<string>,
): { added: number; merged: number; skipped: number; excluded: number; summaryFilled: number } {
  const seenInFeed = new Set<string>(); // 同一フィード内の同一URL（更新entry等）を弾く
  let added = 0;
  let merged = 0;
  let skipped = 0;
  let summaryFilled = 0;
  let excluded = 0;
  for (const item of items) {
    if (seenInFeed.has(item.url)) {
      skipped++;
      continue;
    }
    seenInFeed.add(item.url);

    // 製品告知など、ソースの exclude 条件にあたるものは取り込まない
    if (isExcluded(source, item)) {
      excluded++;
      continue;
    }

    const current = existing.get(item.url);
    if (!current) {
      const article: Article = {
        id: ulid(),
        url: item.url,
        title: item.title,
        summary: item.summary,
        published_at: item.published_at,
        fetched_at: fetchedAt,
        language: item.language,
        source_id: source.id,
        tags: source.default_tags ?? [],
        llm_tags: [],
        has_code: item.has_code ?? null,
        external_ids: item.external_ids ?? {},
        metrics: item.metrics ?? {},
      };
      existing.set(article.url, article);
      changedMonths.add(article.published_at.slice(0, 7));
      added++;
    } else if (item.metrics) {
      // 既存記事に aggregator の metrics をマージする。title/summary/published_at/source_id は変更しない。
      current.metrics = { ...current.metrics, ...item.metrics };
      current.external_ids = { ...current.external_ids, ...item.external_ids };
      changedMonths.add(current.published_at.slice(0, 7));
      merged++;
    } else if (!current.summary && item.summary) {
      // 取り出しが直って要約が取れるようになった既存記事を埋める。
      // 情報が増える方向にしか動かさない（既にある要約は上書きしない）
      current.summary = item.summary;
      // 要約が無かったせいで3行サマリを作れなかった記事は、作り直せるようになる。
      // title_ja が処理済みフラグを兼ねているので、消して和訳ジョブの対象に戻す
      if (current.title_ja && !current.summary_ja?.length) {
        delete current.title_ja;
        delete current.summary_ja;
      }
      changedMonths.add(current.published_at.slice(0, 7));
      summaryFilled++;
    } else {
      skipped++;
    }
  }
  return { added, merged, skipped, excluded, summaryFilled };
}

/**
 * タグ付け段階。ルールベースで全記事の tags を再計算し、それでも0個の記事を LLM に回す。
 * tags/llm_tags が変わった記事の月を changedMonths に足すことで保存対象に含める。
 */
async function tagArticles(
  existing: Map<string, Article>,
  changedMonths: Set<string>,
  runner: LlmRunner | null,
): Promise<void> {
  const taxonomy = loadTaxonomy();
  const sourceById = new Map(loadAllSources().map((s) => [s.id, s]));

  let ruleChanged = 0;
  for (const article of existing.values()) {
    const next = ruleTags(article, sourceById.get(article.source_id), taxonomy);
    if (next.join("\0") !== article.tags.join("\0")) {
      article.tags = next;
      changedMonths.add(article.published_at.slice(0, 7));
      ruleChanged++;
    }
  }

  // 新しい記事から順に LLM に回す（サイトのトップに出る記事を先に埋めるため）。
  // social（HN・はてブ）は技術記事でないものが半数を占め、タグが付かなくて当然のものが多い。
  // /social/ は日付順に読むページでタグを必要としないため、対象から外す
  // llm_tagged_at が付いた記事は「LLMが見て該当タグなしと確定させた」もの。
  // llm_tags: [] は既定値で未判定と区別できないため、時刻の有無で切る（再判定は retag --llm-reset）
  const untagged = [...existing.values()].filter(
    (a) => a.tags.length === 0 && a.llm_tags.length === 0 && !a.llm_tagged_at,
  );
  const candidates = untagged
    .filter((a) => categoryOf(sourceById.get(a.source_id)?.type) !== "social")
    .sort((a, b) => (a.published_at === b.published_at ? 0 : a.published_at < b.published_at ? 1 : -1));
  console.log(
    `ルールベースタグ付け: ${ruleChanged} 件更新 / LLM候補 ${candidates.length} 件` +
      `（未タグ ${untagged.length} 件のうち social ${untagged.length - candidates.length} 件は対象外）`,
  );

  if (!runner) {
    console.log("LLMタグ付け: APIキー未設定のためスキップ");
    return;
  }

  const { updated } = await tagWithLlm(candidates, taxonomy, runner);
  for (const article of updated) {
    changedMonths.add(article.published_at.slice(0, 7));
  }
}

/**
 * 和訳段階。英語記事に和訳見出しと3行サマリを付ける。
 * タグ付けと同じ Runner を受け取り、1回の collect のリクエスト予算を共有する
 * （タグ付けが先に走るので、和訳が使えるのは残りの予算）。
 */
async function translateArticles(
  existing: Map<string, Article>,
  changedMonths: Set<string>,
  runner: LlmRunner | null,
): Promise<void> {
  const candidates = translateCandidates(existing.values());
  console.log(`和訳候補: ${candidates.length} 件（英語・未処理。social も対象）`);

  if (!runner) {
    console.log("和訳: APIキー未設定のためスキップ");
    return;
  }

  const { updated } = await translateWithLlm(candidates, runner);
  for (const article of updated) {
    changedMonths.add(article.published_at.slice(0, 7));
  }
}

/**
 * refresh を立てると条件付きGET（ETag / If-Modified-Since）を1回だけ外す。
 * 取り出しの実装を直したとき、304 を返すフィードは中身を取得しないので過去分に効かない。
 * そのための「もう一度だけ全部取り直す」手段（`pnpm collect --refresh`）。
 */
export async function collect({ refresh = false } = {}): Promise<void> {
  const sources = loadSources();
  const existing = loadExisting();
  const feedState = loadFeedState();
  const fetchedAt = new Date().toISOString();
  console.log(`ソース ${sources.length} 件、既存記事 ${existing.size} 件`);

  const results: SourceResult[] = [];
  const changedMonths = new Set<string>();
  let totalAdded = 0;

  for (const source of sources) {
    const sourceState = feedState[source.id] ?? defaultSourceState();
    feedState[source.id] = sourceState;
    if (refresh) {
      // 条件付きGETのヘッダを落として無条件に取りに行く。値は応答から入れ直される
      sourceState.etag = null;
      sourceState.last_modified = null;
    }
    try {
      const outcome = await fetchItems(source, sourceState, existing);
      const { added, merged, skipped, excluded, summaryFilled } = mergeItems(outcome.items, source, existing, fetchedAt, changedMonths);
      totalAdded += added;
      results.push({
        source,
        added,
        merged,
        skipped,
        excluded,
        summaryFilled,
        notModified: outcome.notModified,
      });

      sourceState.consecutive_failures = 0;
      sourceState.last_success = fetchedAt;
      if (outcome.etag !== undefined) sourceState.etag = outcome.etag;
      if (outcome.lastModified !== undefined) sourceState.last_modified = outcome.lastModified;
    } catch (e) {
      sourceState.consecutive_failures += 1;
      results.push({
        source,
        added: 0,
        merged: 0,
        skipped: 0,
        excluded: 0,
        summaryFilled: 0,
        notModified: false,
        error: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  // 1回の collect で使えるリクエスト予算を Runner が一括で持つ。
  // タグ付けと和訳が同じ Runner を共有するので、予算管理は1本のまま
  const runner = isLlmEnabled() ? new LlmRunner() : null;
  await tagArticles(existing, changedMonths, runner);
  await translateArticles(existing, changedMonths, runner);

  // 変更のあった月に属する記事全件を集めて、その月のファイルだけ全量書き直す
  const toSave: Article[] = [];
  for (const article of existing.values()) {
    if (changedMonths.has(article.published_at.slice(0, 7))) {
      toSave.push(article);
    }
  }
  saveAll(toSave);
  saveFeedState(feedState);

  for (const r of results) {
    if (r.error) {
      console.error(`✗ ${r.source.id}: ${r.error.message}`);
    } else if (r.notModified) {
      console.log(`✓ ${r.source.id}: 304 Not Modified`);
    } else {
      console.log(
        `✓ ${r.source.id}: 新規 ${r.added} 件 / metrics更新 ${r.merged} 件 / 既存スキップ ${r.skipped} 件` +
          (r.summaryFilled > 0 ? ` / 要約を補完 ${r.summaryFilled} 件` : "") +
          (r.excluded > 0 ? ` / 除外 ${r.excluded} 件` : ""),
      );
    }
  }
  const failed = results.filter((r) => r.error).length;
  console.log(`合計: 新規 ${totalAdded} 件追加、失敗ソース ${failed}/${results.length}`);

  const struggling = sources.filter((s) => feedState[s.id]!.consecutive_failures >= FAILURE_THRESHOLD);
  if (struggling.length > 0 && process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      "## 収集失敗が継続しているソース",
      "",
      "| id | 連続失敗回数 | 最終成功日時 |",
      "|---|---|---|",
      ...struggling.map((s) => {
        const st = feedState[s.id]!;
        return `| ${s.id} | ${st.consecutive_failures} | ${st.last_success ?? "なし"} |`;
      }),
      "",
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  }

  if (failed === results.length && results.length > 0) {
    process.exitCode = 1; // 全滅のときだけ失敗にする（部分失敗は運用で拾う）
  }
}
