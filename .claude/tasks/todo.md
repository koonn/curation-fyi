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
- CI検証: `gh workflow run collect` (run 31416416137) → 成功。ログ `✓ hn-frontpage: 新規 1 件 / metrics更新 47 件`（mercari-engineeringのみ既知の403、A-6で対処予定）

### A-3: はてなブックマーク fetcher（fetchers/hatena.ts）— 完了（2026-08-11）

- `fetchers/hatena.ts` 新規作成。rss-parser の customFields で `hatena:bookmarkcount`/`dc:date` を取得
- `toSummary` を `fetchers/rss.ts` から export し共通利用
- `collect.ts` のディスパッチに `hatena_hotentry` を追加
- `data/sources.yaml` に `hatena-hotentry-it` を追記
- typecheck: 通過
- 検証1: `pnpm collect` → `✓ hatena-hotentry-it: 新規 30 件`（期待15〜30の範囲内、上限ぴったり）
- 検証2: `grep -h hatebu_count data/articles/*.jsonl | wc -l` → **30**（期待15以上）
- 検証3（追加確認）: 重複URLチェック → 0
- CI検証: `gh workflow run collect` (run 31416416137) 成功、mercari-engineeringのみ既知403

### A-4: arXiv fetcher（fetchers/arxiv.ts）— 完了（2026-08-11）

- `fetchers/arxiv.ts` 新規作成。rss-parserでAtomフィードをパース、entry.id からバージョン接尾辞(`v\d+`)を除去してarxiv_idとurlを生成
- `noUncheckedIndexedAccess` により正規表現マッチの `m[1]` が `string | undefined` になる点を `m?.[1] ?? null` で対応（tsconfig.base.jsonの既存設定、実装時に typecheck で検出）
- `collect.ts` のディスパッチに `arxiv_api` を追加
- `data/sources.yaml` に `arxiv-cs` を追記
- typecheck: 通過
- 検証1: `pnpm collect` → `✓ arxiv-cs: 新規 50 件`（期待40〜50の範囲内、上限）
- 検証2: バージョン接尾辞残存チェック → **0**
- 検証3（追加確認）: 重複URLチェック → 0
- CI検証: `gh workflow run collect` (run 31440457053) 成功、mercari-engineeringのみ既知403

### A-5: Conditional GET と失敗カウント — 完了（2026-08-11）

- `data/state/feed-state.json` 新規（git管理）。`state.ts` に load/save/defaultSourceState を実装
- `fetchers/rss.ts`: `parser.parseURL` → `fetch()` + `parser.parseString()` に変更。If-None-Match/If-Modified-Sinceを送信、304時は`{items:[], notModified:true}`を返す
- `collect.ts`: ソースごとに成功時 `consecutive_failures=0`・`last_success`更新、失敗時 `+=1`。`consecutive_failures>=7` のソースがあれば `GITHUB_STEP_SUMMARY`（存在時のみ）に見出し+表を追記
- typecheck: 通過
- 検証1: `pnpm collect` を2回連続実行 → 2回目のログに `304 Not Modified` **3件**（cloudflare-blog / martinfowler / jxck。期待1件以上）
- 検証2: `stripe-blog` の feed_url を存在しないURLに変えて7回実行 → `consecutive_failures` が **7** になり、`GITHUB_STEP_SUMMARY` に見出し+表（stripe-blog, 7, 最終成功日時）が出力されることを確認。検証後 feed_url を戻し正常実行1回で `consecutive_failures` が **0** に復旧したことを確認
- CI検証: `gh workflow run collect` (run 31441640725) 成功。ログに `304 Not Modified` **3件**（cloudflare-blog/martinfowler/jxck）。mercari-engineeringは既知403。arxiv-csが一時的に20秒タイムアウトで失敗したが、これはA-5のconsecutive_failuresが正しく1として記録する想定どおりの動作（7回連続しない限り実害なし。次回CI実行で回復を確認する）

### A-6: mercari 403の対処 — 完了（2026-08-11）

- 手順1-2: 一時ブランチ `tmp/a6-mercari-ua-diagnosis` でUser-Agentをブラウザ風に変更しpush、`gh workflow run collect --ref` で実行（run 31441877185）→ **依然として403**（ログ確認済み）
- 手順3: UA変更でも403が続いたためIP起因と判断。`sources.yaml` の `mercari-engineering` を `enabled: false` にし、name行に `# CIのIPが403になるため無効化（2026-08-10 診断）` を追記
- 手順4: 一時ブランチを削除（`git push origin --delete` + `git branch -D`）
- 検証: `gh workflow run collect` (run 31442147625) → 成功。ログに `✗ mercari` の行が**出ない**ことを確認（A-6完了条件クリア）。hatena-hotentry-itが一時的に20秒タイムアウトで失敗したが、arxiv-cs同様に一過性のネットワーク事象でA-5の失敗カウント機構がconsecutive_failures=1として記録するのみ（7回連続しない限り実害なし）

### A-7: 言語判定と has_code — 完了（2026-08-11）

- 依存追加: `tinyld`（pipeline）
- `normalize.ts` に `detectLanguage(text, fallback)` を追加。tinyldの `detect()` が `"ja"` → `"ja"`、空文字（判定不能）→ `fallback`、それ以外 → `"en"`
- `fetchers/rss.ts`: customFields で `content:encoded` を取得し、`item["content:encoded"] ?? item.content` に対し `/<pre[\s>]|<code[\s>]/` をテストして `has_code` を設定。`source.language === "mixed"` のときのみ `detectLanguage(title + summary, "en")` を使用（既存の具体値ソースは判定しない）
- `fetchers/types.ts` に `FetchedItem.has_code?: boolean | null` を追加、`collect.ts` の新規記事生成で `item.has_code ?? null` を使用
- typecheck: 通過
- 検証1: `pnpm --filter @curation-fyi/pipeline exec tsx -e "..."` → `ja en`（design.md記載の期待値と一致）
- 検証2: `grep -hL '"language"' data/articles/*.jsonl | wc -l` → **0**（期待0件）
- 検証3: `grep -h '"has_code": true' data/articles/*.jsonl | wc -l` → **実測0件**（design.md期待値は1件以上）。**ユーザー確認済み・実装のまま先へ進む方針で合意**
  - 原因: (a) design.mdは「jxck/cookpadのフィードは本文全文を含む」としていたが、実データではjxckのAtomフィードは要約のみで本文全文を含まない（`content`/`content:encoded`フィールドなし）。本文全文を持つのはcookpadのみ（実測: 直近30件中14件がコード片を含む）
  - (b) A-1の設計上、既存記事（`existing.has(url)`）はmetricsマージ以外のフィールドを書き換えない。cookpadの既存30件は全てv0時点で取得済み（has_code判定が実装される前）で、今回のcollectでもcookpadの新着は0件のため、has_code判定が走る対象がまだ存在しない
  - 対応: 実装は変更せず維持。cookpadに新着記事が出た次回以降のcollectで自然にhas_code:trueが現れる想定。mixedソース同様「実装とテストのみ行う」の扱いとして先へ進む

## レビュー（v0 実装分）

- 初回収集で463記事（6ソース、2016年〜のバックフィル含む）。CI初回コミットで464件
- 発見して修正したバグ2件:
  1. 同一フィード内の同一URL重複（martinfowler の atom は記事更新ごとに同一リンクの
     エントリを持つ）→ フィード内 seen セットで排除
  2. CI で collect がハング（フェッチ失敗時に残るソケットがイベントループを維持。
     ローカルでは全ソース成功のため再現しなかった）→ 明示的 process.exit + timeout-minutes: 15
- 既知の問題: mercari-engineering が CI の IP からのみ 403（対処手順は design.md タスク A-6）
- コミット: 8b2ecd9（v0）、5347ada（CIハング修正）、52bfb6f（CI初回データ）
