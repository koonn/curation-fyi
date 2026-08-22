import { displayTags, loadArticles } from "../lib/load-articles";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/** フィルタバー用の直近90日メタデータ。1件あたりのフィールドはこれで全部（増やすと転送量に直結する） */
export function GET() {
  const since = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
  const items = loadArticles()
    .filter((a) => a.published_at >= since)
    .map((a) => ({
      u: a.url,
      t: a.title,
      // 和訳見出しと3行サマリ。**入れないとフィルタした瞬間に見出しが英語へ戻り、
      // 要約が丸ごと消える**（FilterBar はサーバー生成の一覧を隠して自前のカードを描くため）。
      // gzip で +82KB になるが、recent.json はフィルタが立ったときだけ取りに行くので、
      // 負担するのは実際にフィルタを使う利用者だけ
      ...(a.title_ja ? { j: a.title_ja } : {}),
      ...(a.summary_ja?.length ? { m: a.summary_ja } : {}),
      d: a.published_at.slice(0, 10),
      l: a.language,
      s: a.source_id,
      g: displayTags(a),
      c: a.has_code === true,
    }));

  return new Response(JSON.stringify(items), {
    headers: { "content-type": "application/json" },
  });
}
