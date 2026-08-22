import { detect } from "tinyld";
import type { Language } from "@curation-fyi/shared";

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|ref$|source$)/;

/**
 * 重複排除キーとしてのURL正規化。
 * https強制・ホスト小文字化・トラッキングパラメータ除去・フラグメント除去・
 * 末尾スラッシュ統一（ルート以外は除去）。
 *
 * keepFragment はフラグメントだけが記事を区別するフィード向けの例外。
 * Anthropic の release notes は全133件が同じページの #anchor 違いなので、
 * 既定の除去を通すと1件に潰れる（132件が同一フィード内重複として捨てられる）。
 */
export function normalizeUrl(input: string, options?: { keepFragment?: boolean }): string {
  const u = new URL(input.trim());
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase();
  if (!options?.keepFragment) u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  if (u.pathname !== "/" && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

/**
 * source.language === "mixed" の記事単位言語判定に使う。
 * 本サイトの言語軸は2値（ja/en）。zh/ko等もen側に倒す（決定済みの仕様）。
 */
export function detectLanguage(text: string, fallback: Language): Language {
  const detected = detect(text);
  if (detected === "ja") return "ja";
  if (detected === "") return fallback;
  return "en";
}
