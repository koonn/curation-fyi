/**
 * サイト内リンクにベースパスを付ける。
 * GitHub Pages のプロジェクトページは /curation-fyi/ 配下に出るため、
 * `/social/` のような絶対パスをそのまま書くとルート直下を指してしまい全部壊れる。
 * サイト内のリンクは必ずこれを通す（外部リンク＝記事の原文URLには使わない）。
 */
const BASE = import.meta.env.BASE_URL;

export function href(path: string): string {
  const base = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
  return `${base}${path}`;
}
