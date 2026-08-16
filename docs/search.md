# 検索の運用

`/search/` は [Pagefind](https://pagefind.app/) による静的サイト内検索。
インデックスは `astro build` の**後**に pagefind CLI が生成する。

```jsonc
// packages/site/package.json
"build": "astro build && pagefind --site dist"
```

このため **`pnpm dev` では検索が動かない**（`/pagefind/` がまだ無いため）。
確認は `pnpm build && pnpm preview` で行う。

## インデックスの範囲

アーカイブのカードだけに `data-pagefind-body` を付けている（`ArticleCard` の `indexable` prop）。
Pagefind はサイト内に `data-pagefind-body` が1つでもあると、その属性を持つページだけをインデックスするため、
トップ・タグ別・ソース別を明示的に除外する必要はない。

実測（2026-08-16）: 153ページ・17,284語。153 はアーカイブのページ数と一致する。

## 既知の問題: 結果が「記事単位」にならない

**Pagefind のインデックス単位はページで、1ページに `data-pagefind-body` が複数あっても1レコードに統合される。**
アーカイブは1ページ20記事なので、検索結果も記事単位にならない。

実測（2026-08-16、`Cloudflare` で検索）:

- 結果は **26件** = 「Cloudflare」を含むアーカイブ**ページ**の数（語の出現は43件）
- 結果タイトルが全て「アーカイブ」（ページの `<title>`）になる
- `data-pagefind-meta="url[href]"` もページ単位のため、1ページ20記事のうち1つのURLが全結果に使われる。
  Cloudflare の検索結果の先頭リンクが無関係な記事のURLになっていた

語の発見（このサイトにその話題があるか）は機能するが、**結果から原文へ正しく飛べない**。

対処案:

1. 見出しに `id` を振り、Pagefind の sub-results で記事単位に見せる
   — リンク先はアーカイブページ内のアンカーになり、原文へは1クリック増える
2. 記事ごとの薄いページを生成して「1ページ1記事」にする
   — 検索としては最も正しくなるが、3000枚超の中身の薄いページがサイトに増える
3. Pagefind の JS API で自前の検索UIを書き、アンカーID→原文URLの対応表を配って差し替える
   — 指定どおりの挙動になるが、UIを自前で持つことになる

未決。
