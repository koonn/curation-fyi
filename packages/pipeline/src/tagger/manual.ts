import fs from "node:fs";
import path from "node:path";
import { categoryOf, type Article } from "@curation-fyi/shared";
import { REPO_ROOT, TAGGING_FILE } from "../paths.ts";
import { loadAllSources } from "../sources.ts";
import { loadExisting, saveAll } from "../store.ts";
import { loadTaxonomy } from "./rules.ts";

/** 1回のエクスポートで出す既定件数。LLM経路の MAX_LLM_PER_RUN と揃える */
const DEFAULT_LIMIT = 100;
/** 作業ファイルを読みやすく保つため要約はここで切る */
const SUMMARY_CHARS = 300;

/** 作業ファイルの1行。`tags` を人（またはエージェント）が埋める */
interface PendingRow {
  url: string;
  title: string;
  summary: string;
  source_id: string;
  language: string;
  /** taxonomy/tags.yaml の slug を0〜3個。空のままなら未判定として扱われ、次回も出てくる */
  tags: string[];
}

/**
 * --file の相対パスはリポジトリルート基準にする。
 * pnpm script 経由だと cwd が packages/pipeline になるため、そのままでは直感と食い違う。
 */
function resolveFile(file: string): string {
  return path.isAbsolute(file) ? file : path.join(REPO_ROOT, file);
}

/** tags も llm_tags も空の記事を新しい順に返す（LLM経路の候補選定と同じ規則） */
function untagged(existing: Map<string, Article>): Article[] {
  return [...existing.values()]
    .filter((a) => a.tags.length === 0 && a.llm_tags.length === 0)
    .sort((a, b) => (a.published_at === b.published_at ? 0 : a.published_at < b.published_at ? 1 : -1));
}

/** 未タグ記事を作業ファイルへ書き出す。sources を渡すとそのソースだけに絞る */
export function exportUntagged(limit = DEFAULT_LIMIT, file = TAGGING_FILE, sources?: string[]): void {
  const out = resolveFile(file);
  const existing = loadExisting();
  const all = untagged(existing);
  // ソースを明示したときはそのまま従う。既定では social（HN・はてブ）を対象から外す
  // （技術タグが付かなくて当然のものが多く、/social/ はタグを必要としないため）
  const candidates = sources?.length
    ? all.filter((a) => sources.includes(a.source_id))
    : (() => {
        const typeById = new Map(loadAllSources().map((s) => [s.id, s.type]));
        return all.filter((a) => categoryOf(typeById.get(a.source_id)) !== "social");
      })();
  const rows: PendingRow[] = candidates.slice(0, limit).map((a) => ({
    url: a.url,
    title: a.title,
    summary: (a.summary ?? "").replace(/\s+/g, " ").slice(0, SUMMARY_CHARS),
    source_id: a.source_id,
    language: a.language,
    tags: [],
  }));

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const taxonomy = loadTaxonomy();
  const scope = sources?.length
    ? `${sources.join(",")} の未タグ ${candidates.length} 件`
    : `social を除く未タグ ${candidates.length} 件 / 未タグ全体 ${all.length} 件`;
  console.log(`tag-export: ${rows.length} 件を ${out} に書き出し（${scope}）`);
  console.log(`利用可能な slug: ${taxonomy.map((t) => t.slug).join(", ")}`);
}

/** 作業ファイルの tags を llm_tags に取り込む */
export function importTags(file = TAGGING_FILE): void {
  const src = resolveFile(file);
  if (!fs.existsSync(src)) {
    throw new Error(`作業ファイルがない: ${src}（先に tag-export を実行する）`);
  }
  const taxonomy = loadTaxonomy();
  const known = new Set(taxonomy.map((t) => t.slug));
  const lines = fs
    .readFileSync(src, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");

  // 先に全行を検証する。1件でも不正なら何も書き込まない
  const rows: PendingRow[] = [];
  const errors: string[] = [];
  lines.forEach((line, i) => {
    let row: PendingRow;
    try {
      row = JSON.parse(line) as PendingRow;
    } catch {
      errors.push(`${i + 1}行目: JSONパース失敗`);
      return;
    }
    if (!row.url) {
      errors.push(`${i + 1}行目: url がない`);
      return;
    }
    if (!Array.isArray(row.tags)) {
      errors.push(`${i + 1}行目: tags が配列でない (${row.url})`);
      return;
    }
    const unknown = row.tags.filter((t) => !known.has(t));
    if (unknown.length > 0) {
      errors.push(`${i + 1}行目: taxonomy にない slug ${JSON.stringify(unknown)} (${row.url})`);
      return;
    }
    rows.push(row);
  });
  if (errors.length > 0) {
    throw new Error(`tag-import: 検証エラー ${errors.length} 件。何も書き込んでいない\n` + errors.join("\n"));
  }

  const existing = loadExisting();
  const changedMonths = new Set<string>();
  let applied = 0;
  let undecided = 0;
  let missing = 0;
  for (const row of rows) {
    if (row.tags.length === 0) {
      // 「どのタグにも合わない」と「まだ判定していない」を区別できないため未判定として残す
      undecided++;
      continue;
    }
    const article = existing.get(row.url);
    if (!article) {
      console.error(`✗ tag-import: 記事が見つからない (${row.url})`);
      missing++;
      continue;
    }
    // taxonomy 記載順に正規化して重複を除く
    const set = new Set(row.tags);
    article.llm_tags = taxonomy.filter((t) => set.has(t.slug)).map((t) => t.slug);
    changedMonths.add(article.published_at.slice(0, 7));
    applied++;
  }

  const toSave = [...existing.values()].filter((a) => changedMonths.has(a.published_at.slice(0, 7)));
  saveAll(toSave);
  console.log(
    `tag-import: ${applied} 件に llm_tags を付与（未判定 ${undecided} 件、記事なし ${missing} 件、書き直した月 ${changedMonths.size} 個）`,
  );
}
