import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";

/**
 * @astrojs/preact は optimizeDeps.include に server 入口を入れるが、その入口は
 * 仮想モジュール astro:preact:opts を import しており、esbuild の依存プリバンドルでは
 * 解決できずビルドが落ちる（exclude を足しても include 側が勝つ）。include から外す。
 */
const dropPreactServerFromPrebundle = {
  name: "curation-fyi:drop-preact-server-from-prebundle",
  config(config) {
    const include = config.optimizeDeps?.include;
    if (include) {
      config.optimizeDeps.include = include.filter((id) => id !== "@astrojs/preact/server.js");
    }
  },
};

export default defineConfig({
  // GitHub Pages のプロジェクトページ。/curation-fyi/ 配下に出るので base が要る。
  // サイト内リンクは src/lib/url.ts の href() を通すこと
  site: "https://koonn.github.io",
  base: "/curation-fyi",
  integrations: [preact()],
  vite: {
    plugins: [tailwindcss(), dropPreactServerFromPrebundle],
  },
});
