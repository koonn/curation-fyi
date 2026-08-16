import { useEffect, useState } from "preact/hooks";

/** recent.json の1件。フィールド名は転送量を抑えるため1文字 */
interface RecentItem {
  u: string;
  t: string;
  d: string;
  l: string;
  s: string;
  g: string[];
  c: boolean;
}

interface Props {
  /** slug → 表示名 */
  tags: [string, string][];
  /** source_id → { name, type } */
  sources: Record<string, { name: string; type: string }>;
  /** このページが扱うソース種別。recent.json をこの範囲に絞る */
  types: string[];
  /** サーバー生成の一覧を隠すための要素 id */
  serverListId: string;
}

const LANG_KEY = "curation-fyi:lang";

const TYPE_LABELS: Record<string, string> = {
  company_blog: "企業ブログ",
  personal_blog: "個人ブログ",
  aggregator: "アグリゲータ",
  paper: "論文",
  tweet: "ツイート",
};

export default function FilterBar({ tags, sources, types, serverListId }: Props) {
  const [lang, setLang] = useState("all");
  const [tag, setTag] = useState("all");
  const [sourceType, setSourceType] = useState("all");
  const [codeOnly, setCodeOnly] = useState(false);
  const [items, setItems] = useState<RecentItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  const active = lang !== "all" || tag !== "all" || sourceType !== "all" || codeOnly;

  // 前回の言語選択を復元する
  useEffect(() => {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved) setLang(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
  }, [lang]);

  // フィルタが立ったときだけ recent.json を取りに行く
  useEffect(() => {
    if (!active || items !== null || loading) return;
    setLoading(true);
    fetch("/recent.json")
      .then((r) => r.json())
      .then((data: RecentItem[]) => setItems(data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [active, items, loading]);

  // サーバー生成の一覧はフィルタ中だけ隠す
  useEffect(() => {
    const el = document.getElementById(serverListId);
    if (el) el.hidden = active;
  }, [active, serverListId]);

  const results = (items ?? []).filter(
    (it) =>
      types.includes(sources[it.s]?.type ?? "") &&
      (lang === "all" || it.l === lang) &&
      (tag === "all" || it.g.includes(tag)) &&
      (sourceType === "all" || sources[it.s]?.type === sourceType) &&
      (!codeOnly || it.c),
  );

  const reset = () => {
    setLang("all");
    setTag("all");
    setSourceType("all");
    setCodeOnly(false);
  };

  return (
    <>
      <div class="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <label class="flex items-center gap-1">
          <span class="text-slate-500">言語</span>
          <select
            class="rounded border border-slate-200 px-1.5 py-1"
            value={lang}
            onChange={(e) => setLang((e.target as HTMLSelectElement).value)}
          >
            <option value="all">すべて</option>
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </label>

        <label class="flex items-center gap-1">
          <span class="text-slate-500">タグ</span>
          <select
            class="rounded border border-slate-200 px-1.5 py-1"
            value={tag}
            onChange={(e) => setTag((e.target as HTMLSelectElement).value)}
          >
            <option value="all">すべて</option>
            {tags.map(([slug, name]) => (
              <option value={slug}>{name}</option>
            ))}
          </select>
        </label>

        {types.length > 1 && (
          <label class="flex items-center gap-1">
            <span class="text-slate-500">種別</span>
            <select
              class="rounded border border-slate-200 px-1.5 py-1"
              value={sourceType}
              onChange={(e) => setSourceType((e.target as HTMLSelectElement).value)}
            >
              <option value="all">すべて</option>
              {types.map((t) => (
                <option value={t}>{TYPE_LABELS[t] ?? t}</option>
              ))}
            </select>
          </label>
        )}

        <label class="flex items-center gap-1">
          <input
            type="checkbox"
            checked={codeOnly}
            onChange={(e) => setCodeOnly((e.target as HTMLInputElement).checked)}
          />
          <span class="text-slate-500">コードを含む</span>
        </label>

        {active && (
          <button type="button" class="ml-auto text-slate-500 underline" onClick={reset}>
            解除
          </button>
        )}
      </div>

      {active && (
        <div>
          <p class="mb-3 text-sm text-slate-500">
            {loading ? "読み込み中…" : `直近90日から ${results.length} 件`}
          </p>
          <div class="flex flex-col gap-3">
            {results.map((it) => (
              <article class="rounded-lg border border-slate-200 bg-white p-4">
                <div class="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <a href={`/sources/${it.s}/1/`} class="font-medium text-slate-600 hover:underline">
                    {sources[it.s]?.name ?? it.s}
                  </a>
                  <span>·</span>
                  <time datetime={it.d}>{it.d}</time>
                  <span class="rounded bg-slate-100 px-1.5 py-0.5 uppercase">{it.l}</span>
                  {it.c && <span class="rounded bg-slate-100 px-1.5 py-0.5">code</span>}
                </div>
                <h2 class="text-base font-semibold leading-snug">
                  <a href={it.u} target="_blank" rel="noopener" class="hover:underline">
                    {it.t}
                  </a>
                </h2>
                {it.g.length > 0 && (
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    {it.g.map((slug) => (
                      <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {tags.find(([s]) => s === slug)?.[1] ?? slug}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
          {!loading && (
            <p class="mt-6 text-sm text-slate-500">
              ここに出るのは直近90日分です。それより古い記事は{" "}
              <a href="/archive/1/" class="underline">アーカイブ</a> か{" "}
              <a href="/search/" class="underline">検索</a> から。
            </p>
          )}
        </div>
      )}
    </>
  );
}
