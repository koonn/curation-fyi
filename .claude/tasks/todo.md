# curation-fyi タスク台帳

- 全体計画: `~/.claude/plans/jaunty-plotting-dragonfly.md`（承認済み）
- **v0.5 / v1 の実装指示書: `.claude/tasks/design.md`**（実装セッションはまずこれを読む）

## v0（最小動作）— 完了

- [x] git init + pnpm workspace 初期化
- [x] packages/shared: Article/Source 型定義
- [x] data/sources.yaml: RSSソース6本（全URLを実フェッチで200確認してから登録）
- [x] packages/pipeline: rss fetcher + URL正規化 + 重複排除 + JSONL追記 + collect CLI
- [x] packages/site: Astro トップページ（新着100件一覧）
- [x] .github/workflows/collect.yml（cron 6時間ごと）
- [x] 検証: `pnpm collect` 2回実行で2回目は新規0件・重複URL 0件（463件中）
- [x] 検証: stripe の feed_url を故意に壊して他5ソースが成功（失敗分離OK）
- [x] 検証: `pnpm build` 成功、dist/index.html に記事カード100件・日英混在（ja42/en58）
- [x] typecheck 全パッケージ通過
- [x] GitHub public repo 作成 + push（koonn/curation-fyi、ユーザー承認済み）
- [x] CI 検証: workflow_dispatch 実行が成功（24秒）し、data/ の自動コミットが main に載った（52bfb6f）
- [ ] Cloudflare Pages 接続（**ユーザー操作待ち**: CF ダッシュボード → Workers & Pages → Pages → Connect to Git → koonn/curation-fyi、Build command `pnpm build`、Build output `packages/site/dist`）
- [ ] 検証: cron が48時間で8回成功し無操作で本番に新記事反映（デプロイ後に確認）

## v0.5 / v1 — 実装中（design.md の A-1〜B-5 の順）

実装セッションへ: 各タスクの「検証」の実測値をこのファイルに記録してから次へ進むこと。

### A-1: Fetcher インターフェースの整理と aggregator マージ — 完了（2026-08-11）

- `FetchedItem` を `packages/pipeline/src/fetchers/types.ts` に切り出し、`external_ids`/`metrics` を追加（rss fetcher はこの型を import）
- `store.ts`: `appendArticles` を削除し `saveAll(articles: Iterable<Article>)` を追加（渡された記事を月でグループ化し月ファイルを全量書き直す。sort: published_at 昇順→id 昇順）
- `collect.ts`: 新規/マージ/スキップの3分岐に変更。`changedMonths` を追跡し、その月に属する既存 Map 全記事を集めて `saveAll` に渡す方式に変更
- typecheck: 全パッケージ通過（`pnpm typecheck`）
- 検証1: `pnpm collect` を2回連続実行 → 2回目後 `git diff --stat data/` は**空**（現行6ソースは全てrss単独でaggregatorが未実装のため、metrics変動自体が発生しない。想定どおり）
- 検証2: 重複URLチェック → **0**
- 現行6ソースは全てRSS単独のためmerge分岐（新規/aggregator系）は本タスクでは未運用。A-2/A-3でHN・はてブfetcherを追加した時点で実際にmergeパスが動くことを確認する
- **追記**: A-2実装後にmergeパスを実運動で確認済み（下記A-2参照）。3回目のcollectでhn-frontpage 48件が「metrics更新」に分岐し、git diffは月ファイルの並び替え＋metrics値の更新のみ（記事内容・件数は不変）、重複URL 0件

### A-2: HN fetcher（fetchers/hackernews.ts）— 完了（2026-08-11）

- `fetchers/hackernews.ts` 新規作成。`fetch()` でHN Algolia APIを叩き、`url === null` の hit（Ask HN等）をスキップ
- `collect.ts` に `fetchItems()` ディスパッチを追加（`rss` | `hn_api` で分岐、他は未対応throw）
- `data/sources.yaml` に `hn-frontpage` を追記（`fetcher: hn_api`、`feed_url` なし）
- typecheck: 通過
- 検証1: `pnpm collect` → `✓ hn-frontpage: 新規 48 件`（期待20〜50の範囲内）
- 検証2: `grep -h hn_points data/articles/*.jsonl | wc -l` → **48**（期待20以上）
- 検証3（追加確認）: 重複URLチェック → 0
- 検証4（A-1のmergeパス実運動）: 3回目の `pnpm collect` で `hn-frontpage: metrics更新 48 件` を確認。git diffで記事のid・件数が不変でmetrics値のみ更新されていることを目視確認
- CI検証はpush後に `gh workflow run collect` で別途実施（結果は下記に追記）

## レビュー（v0 実装分）

- 初回収集で463記事（6ソース、2016年〜のバックフィル含む）。CI初回コミットで464件
- 発見して修正したバグ2件:
  1. 同一フィード内の同一URL重複（martinfowler の atom は記事更新ごとに同一リンクの
     エントリを持つ）→ フィード内 seen セットで排除
  2. CI で collect がハング（フェッチ失敗時に残るソケットがイベントループを維持。
     ローカルでは全ソース成功のため再現しなかった）→ 明示的 process.exit + timeout-minutes: 15
- 既知の問題: mercari-engineering が CI の IP からのみ 403（対処手順は design.md タスク A-6）
- コミット: 8b2ecd9（v0）、5347ada（CIハング修正）、52bfb6f（CI初回データ）
