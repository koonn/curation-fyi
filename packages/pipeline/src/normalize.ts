const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|ref$|source$)/;

/**
 * 重複排除キーとしてのURL正規化。
 * https強制・ホスト小文字化・トラッキングパラメータ除去・フラグメント除去・
 * 末尾スラッシュ統一（ルート以外は除去）。
 */
export function normalizeUrl(input: string): string {
  const u = new URL(input.trim());
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  if (u.pathname !== "/" && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}
