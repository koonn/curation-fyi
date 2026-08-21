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
- [x] 検証: cron が48時間で8回成功（2026-08-16 確認: 直近15回のスケジュール実行が全て success。48時間では9回すべて成功）
- [x] ホスティング: **GitHub Pages に変更**（2026-08-16）
  - 前回セッションの申し送りにあった「Cloudflare Pages の接続をやった」は**事実と違っていた**。ユーザーに確認したところ未着手で、`curation-fyi.pages.dev` は名前解決もできない状態だった（DNS・通信が生きていることは example.com / github.com / developers.cloudflare.com が200であることで確認済み）。GitHub の Deployments も0件
  - ダッシュボード操作が要らず repo 内で完結するため、ユーザー判断で GitHub Pages に切り替え
  - URL: **https://koonn.github.io/curation-fyi/**（プロジェクトページなので `/curation-fyi/` 配下）
- [x] 検証: 本番が公開され全ページが応答する（2026-08-16）
  - 主要9パス（/ /social/ /papers/ /hot/ /sources/ /archive/1/ /search/ /feed.xml /recent.json）すべて HTTP 200
  - Pagefind の資産3つ、トップが参照する JS/CSS 3つ（CSS・FilterBar island・Preact ランタイム）すべて実体を取得できることを確認
  - サイト内絶対リンク **32,030個すべてに base が付いている**（ビルド出力を走査して0件の漏れを確認）
  - ブラウザ実測（本番）: `/search/` で `Cloudflare` → 43件、リンク先は原文URL、`bundlePath` は `/curation-fyi/pagefind/`
  - ブラウザ実測（本番）: トップで言語=日本語 → サーバー生成分が hidden になり196件に絞り込み、EN バッジ0件、`localStorage` に `ja` が保存される
- [ ] 検証: 無操作で本番に新記事が反映される（cron → collect → deploy の連鎖）
  - **落とし穴**: `collect` が `GITHUB_TOKEN` で push したコミットは push イベントを起こさない（ワークフロー再帰を防ぐGitHubの仕様）ため、`deploy` の `push` トリガーだけでは連鎖しない。`workflow_run`（collect の完了を契機にする）を追加して対処した

## v0.5（A-1〜A-8）— 完了 / v1（B-1〜B-5）— 着手中

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
- CI検証: `gh workflow run collect` (run 31443563975) 成功。hatena-hotentry-itがCIで3回連続タイムアウト中（`consecutive_failures: 3`）。A-5の失敗カウント機構どおり追跡されており、7回に達すればGITHUB_STEP_SUMMARYで可視化される。現時点では実害なし・監視継続

### A-8: 企業・個人ブログのソース拡充 — 完了（2026-08-11）

- 候補24件を手順どおり診断:
  - `curl -A "curation-fyi/0.1"` で200確認できたもの21件をそのまま登録
  - `uber-engineering`: 全パスで406（Cloudflareのbot判定と推測、ブラウザUAでも解消せず）。ページ内にRSS/Atomの`<link>`も無し → **フィードなしとしてスキップ**（sources.yamlに未登録）
  - `linkedin-engineering` / `anthropic-news`: 候補URLが404。各サイトTOPページのHTMLに `<link rel="alternate" type="application/[rss|atom]+xml">` が存在せず → **フィードなしとしてスキップ**
  - `naoya`: 候補URL欄が「手順1で探す」だったため探索。`https://naoya-2.hatenadiary.org/rss` が200・パース可能だが最新記事は2016年（更新停止中のレガシーブログ）。手順どおり200なので登録し、nameフィールドにコメントで実情を明記
  - `shopify-engineering`: curlでは200だったが実際は `blog.atom` がHTMLトップページへの301リダイレクトになっておりXMLパース不能（`pnpm collect`で✗）。リダイレクト先HTMLにもRSS/Atomリンクなし → 手順3どおりエラーメッセージを記録し `enabled: false`
- typecheck: 通過
- 検証1: 有効ソース数 → `loadSources().length` で**29件**（pyyaml未インストールのためdesign.md記載のpython3+yamlコマンドの代わりに、本番と同じsources.tsのloaderで計測。期待25以上をクリア）
- 検証2: `pnpm collect` の失敗ソース → 途中複数回 `hatena-hotentry-it`（タイムアウト）・`arxiv-cs`（429/タイムアウト、本セッションでの短時間の連続実行が原因と推測）が一過性で失敗したが、時間を置いての最終実行では **失敗ソース0/29** を達成。新規追加した24候補由来の恒常的な失敗はshopify-engineeringのみで、これは無効化済み
- 検証3: 総記事数 → **3105件**（期待900件以上を大幅にクリア。内訳: vercel-blogが全履歴1450件・azukiazusaが458件と大きく寄与）。重複URLチェック0件

### B-1: ルールベースタグ付け — 完了（2026-08-16）

- `taxonomy/tags.yaml` 新規作成（design.md記載の14タグをそのまま使用）。`paths.ts` に `TAXONOMY_FILE` を追加
- `shared/src/schema.ts` に `Tag` 型を追加（共通ルール「型はすべてshared」に従う。B-3のsite側 `loadTagMap()` でも使う）
- `tagger/rules.ts` 新規作成: `loadTaxonomy()` / `ruleTags(article, source, taxonomy)`。enは `\b`+escapeRegExp+`\b`（i）、jaは `includes`、対象テキストは `title + " " + (summary ?? "")`、返り値は taxonomy 記載順
- `sources.ts`: `loadAllSources()`（無効化済みを含む全件）を切り出し、`loadSources()` はその `enabled` フィルタに変更。retagは無効化済みソース（mercari/shopify）の既存記事も正しく引けるようにするため前者を使う
- `retag.ts` 新規作成 + `index.ts` に `retag` サブコマンド追加。pipeline/rootの package.json に `retag` スクリプトを追加
- typecheck: 全パッケージ通過
- 検証1: タグ付与率 → **2260/3915 = 57.7%**（design.md期待値60%以上に対し**未達**。判断を仰いだ結果「このまま先へ進む」でユーザー合意）
  - 原因はデータ構成の変化。design.mdは「~1000記事」前提で60%を置いていたが、A-8でソース29件・3915記事に増え、内訳が変わった
  - 内訳実測: summaryあり3170件 → 66.1% / **summaryなし745件 → 22.1%** / vercel-blog+hn-frontpageを除く2098件 → **63.3%**（この母集団なら目安を満たす）/ en 55.2% / ja 61.9%
  - 押し下げているのは vercel-blog 1471件（全体の38%・製品リリース告知中心・41%未タグ）と hn-frontpage 346件（summary無しでタイトルのみ・84%未タグ）
  - 実装の妥当性確認: 未タグ記事20件をランダム抽出して目視 → いずれも taxonomy のキーワードを実際に含まない記事（家電のお買い得情報・Changelog・製品告知等）。一般語による誤検出も測定（`agent` 182件・`API` 178件・`Go` 40件）し、技術記事コーパスとして妥当な範囲と判断
  - design.mdは60%を「ルールのみでの実測目安」とし本目標95%はB-2のLLM併用後としているため、実装は変更せず記録して先へ進む
- 検証2: 決定性 → `retag` を2回連続実行し、1回目の `data/articles/` 全体をコピーして2回目と `diff -rq` → **差分なし**（全111ファイル一致）

### B-2: LLM タグ付け・要約 — 実装完了 / 検証は手動経路で実施（2026-08-16）

- スキーマ: `Article.llm_tags: string[]` を追加。`store.loadExisting()` で `??= []` 補完（既存データは saveAll 時に永続化）
- `tagger/llm.ts` 新規: `@anthropic-ai/sdk`、`claude-haiku-4-5-20251001`、`max_tokens: 300`、`MAX_LLM_PER_RUN = 100`。design.md記載のプロンプトをそのまま使用。JSON.parse失敗はスキップ＋ログ、taxonomyにないslugは捨てる。`usage` を合算して概算コストをログ出力
- `collect.ts` にタグ付け段階 `tagArticles()` を追加。呼び出し順はルールベース → 残りがLLM対象。LLM候補は**新しい順**（design.mdに規定がないため、サイトのトップに出る記事から埋まるよう判断。todo記録）
- 検証1（APIキー未設定時のスキップ）: `pnpm collect` → `LLMタグ付け: APIキー未設定のためスキップ` / `ルールベースタグ付け: 0 件更新 / LLM候補 1677 件`。2回連続実行でルールベース更新0件（冪等）
- typecheck: 全パッケージ通過

#### B-2追加: APIキーなしの手動タグ付け経路（ユーザー要望により正規手順化）

design.md はAPIキー前提だが、キーを渡さない運用を正規手順にしたいとの指示により、
同じ `llm_tags` に書く手動経路を追加した。②LLM と ③手動 はどちらか一方があればよい関係。

- `tagger/manual.ts` 新規 + CLI サブコマンド `tag-export` / `tag-import`（root/pipeline に pnpm script 追加）
- `tag-export --limit N` → `data/tagging/pending.jsonl`（gitignore追加）に1行1記事のJSONLを出力。対象条件・並び順はLLM経路と同一。要約は300字で切る
- `tag-import` → taxonomyにないslugが1つでもあれば**何も書き込まずエラー**（typoを握り潰さない）。tagsが空の行は「未判定」として何も書かない
- 手順は `docs/tagging.md` に記載（正典）
- 検証2（手動経路の通し実行、2026-08-16）: 100件をエクスポート → Claude Codeセッションで判定 → インポート
  - `tag-import: 39 件に llm_tags を付与（未判定 61 件、記事なし 0 件、書き直した月 1 個）`
  - **付与率: 2308/3946 = 58.5%**（design.md B-2期待値95%以上に対し**未達**）
  - タグ別内訳: llm 670 / frontend 571 / infrastructure 315 / performance 304 / paper 289 / backend 273 / team-process 241 / security 186 / architecture 129 / programming-language 128 / machine-learning 114 / database 97 / mobile 78 / data-engineering 48
  - コスト実測: **$0（APIを呼んでいない）**。design.mdのコスト条件（100記事で$0.15未満）はAPI経路を回したときに測る
- **重要な実測（design.mdの前提と食い違う）**: 100件中**61件が「どのタグにも合わない」空判定**
  - 空判定61件のソース内訳: hn-frontpage 42 / hatena-hotentry-it 18 / simonwillison 1
  - 中身は心臓病・エルニーニョ・スポーツ・防災アプリ・政治など、技術記事でない一般ニュース。この2ソースは技術限定ではない集約サイトなので構造的に混ざる
  - design.mdのLLM対象条件は「tagsも0個かつllm_tagsも0個」なので、**空判定の記事は毎回対象に戻る**。61%という率だと未タグキューが永久に減らない
  - 付与率95%は、受け皿タグの追加か対象条件の変更なしには到達不能（対処案3つを `docs/tagging.md` に記載）
  - ユーザー合意により「実測してから判断する」方針
- **層化抽出による追加実測（2026-08-16）**: 上記100件は**新しい順**にエクスポートしたため96件が hn-frontpage / hatena-hotentry-it に偏っており、未タグ母集団を代表していなかった（この2ソースは未タグ1646件のうち27%にすぎない）。最大の供給源は vercel-blog 596件・jxck 216件・discord-engineering 82件で、バッチにほぼ含まれていなかった
  - 対処として `tag-export` に `--source` を追加し、上位3ソースから各12件を層化抽出して判定（`--file` の相対パスが `packages/pipeline` 基準になるバグも同時に修正）
  - ユーザー指示「製品告知は不要」に従い、製品告知は空判定とした
  - 結果（判定済み計136件）: discord-engineering 10/12=83% / hn-frontpage 42/64=66% / vercel-blog 8/13=62% / hatena-hotentry-it 18/32=56% / simonwillison 1/2=50% / **jxck 0/12=0%** / 合計 79/136=58%
  - 空判定は2種類に分かれる: **(a) そもそも技術記事でない**（hn-frontpage・hatena-hotentry-it）と **(b) 技術ドメインだが製品告知**（vercel-blog `/changelog/`、discord-engineering の Changelog/Patch Notes）
  - **(b)はタグ付けの問題ではない**: vercel-blog `/changelog/` 881件（全記事の22%）のうち**529件は既にルールベースでタグが付いており**、タグ付け段階を直しても表示からは消えない。収集または表示の段階で切る必要がある
  - 現在の付与率: **2317/3945 = 58.7%**（llm_tags あり57件、未タグ残1628件）
  - 対処案3つと見分けの手掛かりを `docs/tagging.md` に記載

### B-2追加: 製品告知の除外（(b)の対処、2026-08-16）

ユーザー判断「URL/タイトルパターンで収集時に弾き、既存も消す」により実施。design.md 範囲外の設計追加。

- `Source.exclude`（`url_contains` / `title_matches`）を schema に追加。判定は `exclude.ts` の `isExcluded()` に集約し、収集と prune で同じ規則を使う
- `collect` は除外対象を取り込まず、`✓ <id>: ... / 除外 N 件` としてログに出す
- `prune` サブコマンド新規（pnpm script は組み込み `pnpm prune` と衝突するため **`prune-excluded`**）。`--dry-run` あり
- `store.rewriteMonths()` を追加。月の記事が0件になったら月ファイルごと削除する
- 設定: vercel-blog に `url_contains: ["/changelog/"]`、discord-engineering に `title_matches: ["Changelog","Patch Notes"]`
- 検証1（削除前の突合、L75）: 消える側904件・残る側の件数とタイトル抜粋を目視。`/changelog/` は全て告知、残る `/blog/` は技術記事であることを確認
- 検証2（件数の再現、L113）: 独立した2経路（python集計と `prune --dry-run`）がどちらも **904件**（vercel-blog 881 / discord-engineering 23）で一致
- 検証3（削除実行）: 3945 → **3041件**（-22.9%）。`/changelog/` 残0件・Changelog/Patch Notes 残0件。月ファイル数は137で不変（空になった月なし）
- 検証4（収集経路）: `pnpm collect` → `vercel-blog: ... / 除外 881 件`、`discord-engineering: ... / 除外 22 件`、両ソースとも新規0件。失敗ソース0/29
- 付与率は 58.7% → **58.8%** とほぼ不変（削除した904件のタグ付与率がコーパス全体とほぼ同じだったため）。未タグ残は1628 → 1254件
- 手順は `docs/sources.md`（新規）に記載
- **残課題**: (a)「そもそも技術記事でない」（hn-frontpage・hatena-hotentry-it）と、空判定記事が毎回対象に戻る問題は未解決。**判断待ち**

### B-3: サイトのページ拡充 — 完了（2026-08-16）

- `load-articles.ts` に `loadTagMap()` / `displayTags()` / `loadEnabledSources()` / `score()` / `paginate()` / `pageEntries()` を追加。`PAGE_SIZE = 20`
- `ArticleCard.astro`: 表示用タグのチップ（`/tags/<slug>/1/` へリンク）、HN/はてブのスコアバッジ、`has_code` バッジ、ソース名リンクを追加
- `Pagination.astro` 新規: 現在ページの前後2ページ＋先頭・末尾のみ表示（アーカイブが153ページあるため全列挙しない）
- `Base.astro`: ナビ（新着 / Hot / ソース / アーカイブ / RSS）と `<link rel="alternate">` を追加
- 新規ページ: `/hot/`、`/sources/`、`/sources/[id]/[page]`、`/tags/[slug]/[page]`、`/archive/[page]`、`/feed.xml`（`@astrojs/rss` 追加）
- 検証1: `pnpm build` 成功。**467ページを2.29秒**（design.md期待値60秒以内を大幅にクリア）
- 検証2: `dist` のHTMLファイル数 → **467**（期待100以上）。内訳 archive 153 / sources 167 / tags 145 / hot 1 / top 1
- 検証3: `/hot/index.html` の **HNバッジ46件・はてブバッジ11件**（期待1件以上）
- 検証4: トップのナビリンク `/hot/` `/sources/` `/archive/1/` `/feed.xml` すべて存在
- 検証5: `dist/feed.xml` のルート要素が `rss`、`<item>` が **50個**（期待50）
- 検証6（ページング）: archive 1ページ目20件 / 最終153ページ目13件 / トップ100件 / hot 50件。記事数3053件に対し `ceil(3053/20)=153`ページ・最終ページ13件と一致
  - ※ 検証中に最終ページ件数が計算と合わないと誤認したが、原因は参照した記事数がprune直後の3041（その後のcollectが12件追加）という古い値だったこと。サイト側は正しい

### B-4: フィルタバー island — 実装完了 / 目視確認のみ未実施（2026-08-16）

- `@astrojs/preact` + `preact` を site に追加。`components/FilterBar.tsx`（Preact island、`client:load`）
- `src/pages/recent.json.ts`（Astroエンドポイント）で直近90日のメタデータを生成。フィールドは design.md 指定の7つ（`u/t/d/l/s/g/c`）だけ
- 状態: 言語（all/ja/en）・タグ（単一選択）・ソース種別（all/company_blog/personal_blog/aggregator/paper）・has_codeトグル。言語は `localStorage["curation-fyi:lang"]` に保存し初回マウントで復元
- フィルタが立った時だけ `/recent.json` を取得（遅延ロード）。サーバー生成の一覧は `#recent-articles` を `hidden` にして隠し、解除で戻す
- **ビルドが通らずハマった点**: `@astrojs/preact` が `optimizeDeps.include` に `@astrojs/preact/server.js` を入れるが、その入口は仮想モジュール `astro:preact:opts` を import しており、Viteのクライアント側依存プリバンドル（esbuild）が解決できずビルドが落ちる。`optimizeDeps.exclude` を足しても **include 側が勝つ**ため効かない。バージョン変更（6.0.2→5.1.5→5.0.2→4.1.3）でも直らず、`DEBUG=vite:deps` と `configResolved` で解決済み設定を実際に覗いて原因を確定させた。対処は astro.config.mjs の自前viteプラグインで include から当該エントリを外す
- 検証1: `pnpm build` 成功、**467ページ 2.48秒**
- 検証2: `dist/recent.json` の **gzip 94,829 bytes**（期待500KB以下を大幅にクリア）。1419件、フィールドは指定の7つのみ、期間 2026-05-18〜2026-08-16
- 検証3: island の props をビルド済みHTMLで確認 → tags 14件・sources 29件・`serverListId: recent-articles`・`client="load"`・`component-url=/_astro/FilterBar.*.js`
- 検証4: FilterBarのフィルタ述語を実データ（dist/recent.json）で実行 → all 1419 / ja 567 / en 852 / ja+llm 165 / codeOnly 89。ja+en=全体が成立
- 検証5（目視）: Chrome拡張がツール呼び出しごとにタブグループを失い（`Couldn't determine which page this action targets`）3回失敗したため、実装者による目視はできず**ユーザーに手順を引き継いで確認してもらい、OKの回答を得た**（2026-08-16）。スクリーンショットは取得できていない
- design.mdからの意図的な差分: フィルタ結果末尾の誘導リンクは `/archive/` のみにした。`/search/` はB-5で作るページなので、先に張ると壊れたリンクになる。B-5で追加する

### B-5: Pagefind 検索 — 実装完了 / 結果の粒度に既知の問題（2026-08-16）

- `pagefind` + `@pagefind/default-ui` を site の devDependency に追加。build を `astro build && pagefind --site dist` に変更
- `ArticleCard` に `indexable` prop を追加し、アーカイブのカードだけ `data-pagefind-body` を付与。タイトルリンクに `data-pagefind-meta="url[href]"`
- `/search/` ページ新規（Pagefind Default UI、日本語のプレースホルダ・0件メッセージ、`processResult` で結果URLを記事原文に差し替える実装）
- ナビと FilterBar 結果末尾に `/search/` へのリンクを追加（B-4で保留していたもの）
- **B-3/B-4のtypecheck漏れを修正**: B-3のページ3枚が `Astro.props` 未型付けでエラー、B-4のFilterBarが `JSX.IntrinsicElements` 不在でエラーだった。B-3では typecheck を回しておらず、B-4ではビルドエラーに紛れて見落としていた。`tsconfig.json` に `jsx: react-jsx` / `jsxImportSource: preact` を追加し、3ページに `type Props` を明示 → **全パッケージ 0 errors / 0 warnings**
- ルートに `preview` スクリプトを追加（無かった）
- 検証1: `pnpm build` 成功。468ページ + Pagefind が **153ページ・17,284語**をインデックス（153＝アーカイブのページ数と一致し、意図どおりアーカイブ限定になっている）
- 検証2: `dist/pagefind/` 存在（183ファイル、`pagefind-ui.js` / `pagefind-ui.css` あり）。`/search/` 生成あり
- 検証3（ブラウザ目視・実施済み）: preview で `/search/` を開き `Cloudflare` を検索 → **「Cloudflareの26件の検索結果」**、ハイライト付きで表示。Pagefind UI・CSS の読み込みも確認
- **既知の問題（design.md の前提が成立しない）**:
  - Pagefind のインデックス単位は**ページ**であり、1ページに `data-pagefind-body` が複数あっても1レコードに統合される。実測でも Cloudflare の結果が **26件 = 「Cloudflare」を含むアーカイブページ数26**（出現は43件）と一致し、記事単位になっていない
  - このため結果タイトルが全て「アーカイブ」（ページのtitle）になる
  - `data-pagefind-meta` も**ページ単位**なので、1ページ20記事のうち1つのURLが全結果に使われる。実測で Cloudflare の検索結果の最初のリンク先が無関係な freee の記事URLだった
  - design.md の「各記事要素に `data-pagefind-meta="url[href]"` でリンク先を外部URLにする」は、1ページに複数記事がある構成では成立しない
  - 対処案: (a) 見出しに `id` を振って Pagefind の sub-results で記事単位に見せる（リンク先はアーカイブページ内アンカー） (b) 記事ごとの薄いページを3053枚生成して1ページ1記事にする (c) Pagefind の JS API で自前の検索UIを書き、アンカーID→原文URLの対応表を別途配って差し替える
  - → **案2（記事ごとの薄いページ）で解決済み。下記参照**

### B-5追補: 検索を記事単位にする（案2の採用、2026-08-16）

ユーザー判断「案2で、Googleに載らないように」により実施。

- `src/pages/a/[id].astro` 新規: 記事1件＝1ページの薄いページ（平均834バイト）。タイトル・要約・ソース名・日付・タグと原文リンクのみ。`data-pagefind-body` と `data-pagefind-meta="url[href]"` を持つ
- アーカイブの `indexable` を外し、インデックス対象を薄いページに移した
- `<meta name="robots" content="noindex,nofollow">` を薄いページだけに出力。サイト内からもリンクしない
- **ハマった点1（言語分割）**: 薄いページの `<html lang>` を記事ごとの言語にしたら Pagefind が ja/en の2インデックスを作り、`lang="ja"` の `/search/` からは ja しか引けず**英語記事が丸ごと検索から落ちた**（実測: Cloudflare が 43件中13件）。`PagefindUI` の `mergeIndex` で en を併合する指定は効かず、`lang="ja"` 固定の単一インデックスにして解決（英語ステミングは諦める）
- **ハマった点2（自分の計測を汚した）**: 説明をHTMLコメントで `<html>` の上に書いたため、3053枚すべてに出力され、静的集計が「Cloudflareを含むページ3016件」と狂った。frontmatterのJSコメントに移して解消。出力漏れ0件を再確認
- 検証1: `pnpm build` → 3521ページ（うち薄いページ3053）。Pagefind が **3053ページ・25,494語・1言語**をインデックス
- 検証2（ブラウザ実測）: `Cloudflare` → **43件**（静的に数えた該当記事数43と一致）、`メルカリ` → **17件**。結果タイトルは記事名、リンク先は原文URL（zenn.dev / engineering.mercari.com 等）を確認
- 検証3（noindex）: 薄いページ 3053/3053 に noindex。通常ページへの漏れ0件。サイト内から `/a/` へのリンク0件
- 検証4（コスト実測）: astro 3521ページを約4秒（変更前は468ページ2.3秒）、Pagefind 1.6〜5秒。`dist` 合計 **18.3MB**（薄いページ2.4MB + Pagefind 3.0MB）
- 既知の非対称: 英語のソース名は検索に引っかかるが日本語のソース名は引っかからない（Cloudflare の43件にはソース名だけの一致6件が含まれるが、「メルカリ Engineering Blog」の約100件は `メルカリ` で出ない）。Pagefind の日本語分かち書きの挙動と見られる。詳細は `docs/search.md`

### 追加: Social / Tech / 論文 のページ分割（2026-08-16）

design.md 範囲外。ユーザー判断「Social Trend と Tech Company の Trend は別物扱い」により実施。

- **着手前の実測（分ける根拠）**: 直近90日1419件のうち aggregator 708件（50%）。新着順のトップ100件は **aggregator 96 / personal_blog 4**、トップ20件は全部 aggregator で、企業ブログがトップページから消えていた。並んでいたのはクレジットカード債務・嗅覚研究・血糖記録アプリ等
- 分類は `load-articles.ts` の `CATEGORIES` に定義（ソースの `type` で切る）: tech = company_blog/personal_blog/tweet（2041件） / social = aggregator（723件） / papers = paper（289件）
- `components/CategoryFeed.astro` 新規（3ページ共通の本体）。`pages/index.astro` を tech に絞り、`pages/social.astro` / `pages/papers.astro` を新設
- `FilterBar` に `types` prop を追加。recent.json をそのページの種別に絞り、**種別セレクトは2種類以上あるときだけ出す**（social/papers では消える）
- ナビを 新着 / Social / 論文 / Hot / ソース / アーカイブ / 検索 に変更
- `/feed.xml` をトップと同じ tech の新着50件に変更（Social と論文は混ぜない）
- `/hot/` は分類と直交するスコア軸なので横断のまま
- typecheck: 全パッケージ 0 errors
- 検証1（ページ構成、静的）: `/` → personal_blog 40 + company_blog 60 = 100件 / `/social/` → aggregator 100件 / `/papers/` → paper 100件。混入なし
- 検証2（ナビ）: 全ページに7リンク存在
- 検証3（feed）: `<item>` 50件、内訳は personal_blog 20 + company_blog 30 の tech のみ
  - ※ 照合スクリプトが一時「?17件」を出したが、これは feed が `'` を `&apos;` にXMLエスケープしているのを私の正規表現が拾えなかっただけ（Simon Willison's Weblog）。feed 自体は正しい
- 検証4（ブラウザ目視）: `/` は Simon Willison / azukiazusa / The Cloudflare Blog、`/social/` は Hacker News / はてなブックマーク（HN・B! バッジ付き）。種別セレクトが social で消えることも確認
- ビルド: 3523ページ / 3.25秒
- 手順とカテゴリ定義は `docs/pages.md`（新規）

### 追加: タグ付けの対象から social を外す（2026-08-16）

ユーザー合意により実施。カテゴリ分割を受けて、再処理問題への対処を軽く済ませる方針。

- **着手前の実測（カテゴリ別のタグ付与率）**: papers 100%（289/289。`paper` タグが無条件で付くため対象外）/ tech 60.2%（未タグ813）/ social 39.0%（未タグ441）
- **tech 未タグ813件から20件を判定**: 12件にタグ付与・8件が空判定（40%）。ただし**この標本は代表的でない**——新着順に取ったため simonwillison が標本の60%を占めた（母集団では3.3%）。空判定8件のうち6件が simonwillison のリンクブログ（「Northern Gannet」「Quoting OpenClaw」等の短文）。simonwillison を除くと 8件中2件（25%）
- **結論**: tech の未タグは「タグの付けようがない」のではなく「キーワードルールの取りこぼし」が主体。未タグの55%を占める vercel-blog(240)+jxck(204) は先の層化抽出で jxck 12/12・vercel `/blog/` 4/4 がタグ付け可能だった
- 実装: 分類定義 `CATEGORIES` / `categoryOf()` を `@curation-fyi/shared` に移し（site と pipeline で二重管理しないため）、`collect` の LLM 候補と `tag-export` の既定対象から social を除外。`--source` で明示したときは従来どおり出せる
- typecheck: 全パッケージ 0 errors
- 検証1（手動経路）: `pnpm tag-export` → `social を除く未タグ 801 件 / 未タグ全体 1242 件`。出た記事は simonwillison 4・discord 1 で aggregator なし
- 検証2（明示指定の上書き）: `--source hn-frontpage` → 290件が従来どおり出る
- 検証3（収集経路）: `pnpm collect` → `LLM候補 801 件（未タグ 1251 件のうち social 450 件は対象外）`
- 検証4: `pnpm build` 成功（3538ページ）
- **残課題**: 処理済みフラグ（空判定の再処理）は未対応。social を外した今、影響は tech の1〜2割程度。判断待ち

## Issue #1: CACM の取得経路スパイク — 完了（2026-08-16）

**結論: cacm.acm.org からの機械的な収集は「見送り」。代わりに ACM Queue が正当に取得できる。**

### 実測1: 全経路が Cloudflare で 403（ローカル・CI の両方）

本番と同じ Node の fetch（undici）で7経路を測定。curl でも同結果。

| 経路 | ローカル | CI（GitHub Actions） |
|---|---|---|
| `/feed/`（pipeline UA） | 403 | 403 |
| `/feed/`（ブラウザ相当ヘッダ一式） | 403 | 403 |
| `/`（HTML トップ） | 403 | 403 |
| `/latest/`（HTML 一覧） | 403 | 403 |
| `/wp-json/wp/v2/posts`（WP REST API） | 403 | 403 |
| `/sitemap.xml` | 403 | 403 |
| `/sitemap_index.xml` | 403 | 403 |

- 応答は全経路で**同一の 5,480B**（Cloudflare の "Attention Required!"）、`server: cloudflare`
- 初回以降は **13〜31ms で即返る**。JS チャレンジではなくエッジでの即時拒否
- **ネットワークを変えても結果が変わらない**（自宅ISP・GitHub Actions の米国IP）。mercari の 403（A-6）と違い、IP 起因ではなくクライアント種別で弾かれている
- UA の差し替え・`Accept` / `Accept-Language` / `Referer` の付与では通らない

### 実測2: robots.txt だけが 200 で返り、宣言と防御が食い違っている

- `robots.txt` は同じUAで **200**（374B）。`User-agent: *` に対する `Disallow` は `/wp-admin/` のみで、**記事パスの巡回自体は許可**されている
- AI クローラ（GPTBot・ChatGPT-User・CCBot・Google-Extended）は明示的に `Disallow`
- `Sitemap: https://cacm.acm.org/sitemap.xml` を案内しているが、**その URL は 403**
- サイト自身が `<link rel="alternate">` で正規フィードを `https://cacm.acm.org/feed/` と宣言しているが、これも 403

### 実測3: `/rss/feeds/*.xml` は WAF を通過するが、CACM 側に実体が無い

- `https://cacm.acm.org/rss/feeds/cacmcontent.xml` → **404 だが本文は 163KB のサイト自身の 404 ページ**（5,480B の Cloudflare ブロックページではない）。つまりこのパス接頭辞はオリジンに到達している
- ただし CACM 側に該当するフィードの実体は無い（`cacmcontent.xml` / `news.xml` / `blogcacm.xml` いずれも 404）
- **この穴は採用しない**。相手が意図的に閉じている経路を迂回することになり、かつ WAF 設定の変更でいつでも塞がる

### 実測4: ACM Queue のフィードは正当に取得できる

- `https://queue.acm.org/rss/feeds/queuecontent.xml` → **200**（`text/xml`、5,432B）。**パイプライン自身の UA のまま**通る
- 実記事 **19件**、最新 2026-08-13。title / link / pubDate すべて取得できる
- 同ホストの HTML トップ（`https://queue.acm.org/`）は 403 なので、WAF の許可はパス単位
- 記事 URL は `https://queue.acm.org/detail.cfm?ref=rss&id=3831358` の形式。**`ref=rss` の扱いを `normalizeUrl` で確認する必要がある**（採用する場合）

### 判断が要る点

CACM 本体は見送りとして、残る選択肢は次の3つ。Issue #3 の扱いはこの判断に従う。

1. ACM Queue を代わりに追加する（実装は通常の rss fetcher で済む）
2. ACM に対してクローラの許可（allowlist）を依頼する。robots.txt の方針上は筋が通る話だが、依頼は人間の作業
3. ACM 系は諦める

### 後片付け

- 調査用ブランチ `spike/cacm-access` と `.github/workflows/spike-cacm.yml` は削除済み（main には一度も入れていない。main への push は deploy を起こすため）
- 既存データに `acm.org` を含む記事は **0件**（HN 経由でも入ってきていない）

## Issue #3: ACM Queue をソースとして収集に載せる — 完了（2026-08-16）

CACM が取得できないため、ユーザー判断で ACM Queue に差し替えて実装した（経緯は Issue #1 の節）。

### 実装

- `SourceType` に `magazine` を新設し、`CATEGORIES` の `tech` に割り当て。**読み手側のラベル対応表2箇所**（`pages/sources/index.astro`・`components/FilterBar.tsx`）にも「技術誌」を追加した
  - `paper` を使わなかった理由: `tagger/rules.ts` が `type === "paper"` の記事に自動で `paper` タグを付け、`/papers/` は「arXiv の新着（cs 系）」と銘打ったページのため。査読プレプリントではない編集記事を混ぜると両方の意味が濁る
  - `company_blog` を使わなかった理由: ACM は企業ではなく、UI に「企業ブログ」と表示されてしまう
- `data/sources.yaml` に `acm-queue` を追加（`fetcher: rss` で足りる）。CACM が使えない理由を同ファイルにコメントで残した（次に追加を試みる人が同じ調査を繰り返さないため）

### 検証（実測値）

- typecheck: 全3パッケージ **0 errors**
- `pnpm collect`: `✓ acm-queue: 新規 19 件`、**失敗ソース 0/30**
- 保存された記事: 19件、**URL に `ref=rss` を含むもの 0件**、URL のユニーク数 19（`normalizeUrl` が `ref` を落とし `id` を残す）
- 重複排除: 2回目の実行は `304 Not Modified` になり**検証にならなかった**ため、`feed-state.json` の `acm-queue` の etag / last_modified を null にして取り直させた上で再実行 → `新規 0 件 / 既存スキップ 19 件`、記事数は19のまま
- `pnpm build`: 成功（3,620ページ、1.6秒）
- ビルド出力の確認: `/sources/acm-queue/1/` に**記事カード19件**、`/sources/` の表に `ACM Queue | 技術誌 | 19`、トップページに3件（新着100件の窓に入る分）、フィルタバーに「技術誌」が出る
- `exclude` は**不要と判断**。19件すべて実務者向けの記事で、ポッドキャスト回・目次のみのエントリ・製品告知の混入はなかった（全19件のタイトルを目視確認）
- **CI からの到達性**（mercari 型の罠の確認）: スパイクで CI から測ったのは cacm.acm.org であり、queue.acm.org はローカルでしか測っていなかった。1回目の CI 実行は `304 Not Modified` になり**200で本文を取れる証明にならなかった**ため、リポジトリ側の `feed-state.json` の acm-queue を null にして push し、CI に取り直させた → `✓ acm-queue: 新規 0 件 / 既存スキップ 19 件`（run 31981104791、失敗ソース 0/30）。CI の IP からも 200 で19件取得できることを実測

### 後続チケットに効く制約

- **フィードに `<description>` が無い**（item は title / link / pubDate / guid のみ）。19件すべて `summary: null` で、これは取得漏れではなくフィードの忠実な反映
- **記事本文も取れない**。`https://queue.acm.org/detail.cfm?id=...` は 403（フィードのパスだけが WAF で許可されている）
- したがって Issue #2 / #4 の和訳・3行サマリは、この19件については**タイトルのみを入力に生成**することになる。要約の質がタイトル依存になる点を #2 の設計時に考慮すること

## Issue #6: LLM 呼び出しを Gemini 無料枠に載せ替え、バッチ化 — 実装完了 / 実キー検証待ち（2026-08-17）

### 無料枠の実数（ユーザーの AI Studio 実測値）

- **60 RPM** / **100 RPD**。律速は日次の100リクエスト（分あたりは今回の規模では当たらない）
- 用途別の必要リクエスト数（バッチ25件で計算）: 和訳バックフィル 1,578件 → 64、タグ付けの積み残し 823件 → 33、合計 **97**（ほぼ1日分）。以降の新着は 30〜50件/日 = 2〜4リクエスト/日
- 定数はこの実数から決めた: `BATCH_SIZE = 25`、`MAX_REQUESTS_PER_RUN = 20`（cron は1日4回なので日80。残り20は手動実行・再実行の余裕）

### 実装

- `src/llm/gemini.ts` を新設。リクエスト予算・429検出・JSON応答を1箇所にまとめた土台。**1回の collect で1つの Runner を共有**するので、#2 で和訳ジョブが増えても予算管理は1本のまま
- `tagger/llm.ts` を Gemini + バッチ化に書き換え。応答は `responseSchema` で構造化させ、**記事は index で対応づける**（順序ズレ・件数不足で他の記事を巻き込まないため）
- `@anthropic-ai/sdk` を削除し `@google/genai`（v2.17.1）を追加。環境変数は `GEMINI_API_KEY`
- モデルは `gemini-3.5-flash-lite`（公式ドキュメントで stable かつ無料枠対象と確認。**models.list での実在確認はキー入手後**）
- `pnpm-workspace.yaml` の `allowBuilds` で `@google/genai` / `protobufjs` のインストール時スクリプトを `false` に明示。**pnpm 11 は未決定のまま非0で終了する**ため、宣言しないと CI の `--frozen-lockfile` が落ちる（スクリプトを実行しなくても import・クライアント生成ができることは確認済み）

### 検証（キー不要の範囲・すべて実測）

- typecheck: 全3パッケージ **0 errors**
- キー未設定時: `LLMタグ付け: APIキー未設定のためスキップ` が出て `pnpm collect` は成功（新規115件、失敗ソース 0/30）
- **バッチ処理の対応づけを偽の Runner で検証（8項目すべて合格）**——APIを呼ばずに、壊れたレスポンスを与えて確かめた:
  - 応答が `[2,0,1]` の順で返っても各記事に自分のタグが入る
  - 3件中1件しか返らなくても、残り2件は**空タグで確定させず未処理のまま残る**（`updated` に入らない＝次回実行の対象に残る）
  - 範囲外の index・同一 index の重複・taxonomy に無い slug はいずれも捨てられる
  - 2バッチ目で上限に当たっても**例外を投げずに打ち切り**、1バッチ目の25件は保たれ、残りは未処理のまま
- 載せ替え前のタグ付与率（基準値）: **1,924/3,299 = 58.3%**（ルールベース1,856件 / LLM 68件。この68件は以前の手動 `tag-import` 由来で、Anthropic 経路は一度も動いていない）

### 実キーでの検証（2026-08-21・CI run 32490725988 で実測）

- **モデルの実在と無料枠での利用可否: 確認済み**。`gemini-3.5-flash-lite` で16リクエストが実際に成功しタグが付いた（`models.list` の照会より強い証拠なので、これをもって確認とする）
- **CI で動作: 確認済み**。`GEMINI_API_KEY` を Secrets に登録（de09af0）した後の実行でタグ付けが走った。所要 1m20s（うちLLMタグ付けは約34秒）
- **実測ログ**: `LLMタグ付け: 400 件処理（16 リクエスト、取りこぼし 0 件、未着手 438 件、入力 30578 tok / 出力 10824 tok） ※利用上限に達したため打ち切り`
  - 取りこぼし0件＝index対応づけは実データでも破綻しなかった
- **タグ付与率: 58.3% → 64.1%**（2,613/4,076）。内訳はルールのみ 2,251 / LLMのみ 362 / 両方 0
  - 母数が 3,299→4,076 に増えているので率の比較には注意。LLM由来のタグ付き記事は 68→362 で、うち68件は以前の手動 `tag-import` 由来。**今回の Gemini 実行で新たにタグが付いたのは約294件**（400件処理のうち残り約106件は「該当タグなし」の空判定）

### 打ち切りの原因が判明（2026-08-21・CI run 32493022860）

429 の本文をログに出すようにして、1回回して確定した:

```
制限: GenerateRequestsPerMinutePerProjectPerModel-FreeTier / 再試行まで 20s
limit: 15, model: gemini-3.5-flash-lite
```

- **律速は日次(RPD)でも自前の予算(20)でもなく、分あたり15リクエスト(RPM)だった**。
  設計時の前提「60 RPM / 100 RPD で、律速は日次の100」は**この モデルでは誤り**。
  無料枠の RPM はモデルごとに違い、`gemini-3.5-flash-lite` は **15 RPM**
- **待ち時間はわずか20秒**（`Please retry in 20.342417174s`）。リクエストを間断なく
  投げるので30秒ほどで15本を使い切って壁に当たっている
- → **20秒待って再開するだけで、いまの予算20リクエストを使い切れる**。
  現在の実装は429で即座に打ち切るので、毎回15〜18リクエストで諦めている

### 2回の実行で進んだこと

| | 14:11 (run 32490725988) | 14:36 (run 32493022860) |
|---|---|---|
| 候補 | 838 | 544 |
| 処理 | 400（16 req） | 450（18 req） |
| 未着手 | 438 | **94** |

- **タグ付与率 58.3% → 71.5%**（2,925/4,089）。`llm_tags` にタグが付いた記事は 68 → **674**
- **未着手の積み残しは 94 件まで減った**。あと1〜2回で新規分に追いつく

### 空判定の再投入が実測で裏付けられた

run 1 の後の候補数が計算と合わない:

- 838 −（タグが付いた 294）= 544 ではなく **438** のはず
- 実際の run 2 の候補は **544** = 438 + **106**
- この106は run 1 で「該当タグなし」と判定された件数と**完全に一致**する

`llm_tags: []` は `collect.ts:88` が全記事に書く既定値（`store.ts:21` が旧データにも埋める）
なので、**「LLMが見て却下した」と「一度も見ていない」がデータ上区別できない**。
候補の絞り込みは `llm_tags.length === 0`（`collect.ts:130`）なので、空判定は毎回戻る。

- run 2 でも 450件中138件が空判定 → **却下済みの再判定プールは既に約244件**
- 次回の候補は「未着手94 + 却下済み約244」で、**予算の7割が再判定に消える**見込み
- クォータが律速と分かった以上、処理済みフラグ（例: `llm_tagged_at`）の導入は先送りできない

### 処理済みフラグを実装（2026-08-22・完了）

**着手前に測って優先順位を入れ替えた**。次回候補は232件＝10リクエストで、**15 RPMの壁（15）に届かない**。
つまり「429で待って再開」はいま発火しない。一方その232件のうち **138件（59%）が却下済みの再投入**
だったので、処理済みフラグを先にやる方が効く。

- `Article.llm_tagged_at?: string`（ISO）を追加。**LLMが判定したら結果が空でも刻む**
- 候補条件を `tags` 空 && `llm_tags` 空 && **`llm_tagged_at` 無し** に変更（`collect.ts` と `manual.ts` の両方。
  ②③で規則を揃える方針は維持）
- `pnpm retag --llm-reset` で全件から `llm_tagged_at` を削除して再判定させる（taxonomy にタグを足したとき用）
- **自動無効化（taxonomyのハッシュ保存）は採らなかった**——15 RPM 下では
  タグ1個の追加で数千件の再判定が走り、数日かけて無料枠を食い潰すため。人が起動する形にした

#### 検証（すべて実データで実測）

- 全3パッケージ typecheck 0 errors
- **候補232件 → 判定後0件**（偽のRunnerで実データを判定。メモリ上のみで保存はしない）。再投入が止まっている
- **付与の分岐も一致**: 10バッチ×先頭5件 = 期待50件に対し実測 `タグ付与 50 / 該当なし 182`
- **永続化**: 1,164件に印を付けて保存 → ディスク上の `grep` で1,164件（`JSON.stringify` に載ることを確認）
- **リセット**: `retag --llm-reset` が1,164件削除と報告 → `grep` で残0。
  ルールベース付与2,251件は従来どおりで副作用なし
- **検証後 `git checkout -- data/` でデータを完全復元**（`data/` は着手前にクリーンなことを確認済み）
- ※ リセットの検証は、印が1件も無い状態で叩いても「0件削除」のno-opにしかならないため、
  **一度実データに書いてから消して**確かめた（L71）

#### あわせて直したドキュメントの腐り

`docs/tagging.md` の②節が **Issue #6 の載せ替え時に更新されておらず**、
`claude-haiku-4-5` / `ANTHROPIC_API_KEY` のままだった（冒頭のサマリ表を含め4箇所）。
現行の Gemini + 25件バッチ + 15 RPM の記述に更新。
`.claude/tasks/design.md` の B-2 実装節にも失効注記を入れた（当初設計として本文は残す）。

### 次にやること（この順で）

1. **429を受けたら `retryDelay` 秒待って再開する**（優先度: 中）。
   いまは積み残しが15リクエスト未満なので発火しないが、**Issue #2 の和訳バックフィル
   （1,578件＝64リクエスト）が乗ると確実に当たる**。そこまでには要対応
2. `BATCH_SIZE` / `MAX_REQUESTS_PER_RUN` を実測で調整する（優先度: 低。1の後）
3. design.md の B-2 完了条件「付与率95%以上」の見直し（優先度: 低）。
   **処理済みフラグは付与率を上げる変更ではない**（再判定を止めて予算を新着に回すもの）。
   付与率は `taxonomy/tags.yaml` に受け皿タグを足すかどうかの判断待ち

### 分かったこと・残っている判断

- **17リクエスト目で API 側の 429 に当たった**。`MAX_REQUESTS_PER_RUN = 20` には届いていないので、**打ち切ったのは自前の予算ではなく Gemini 側の上限**。34秒で17リクエスト（約30 RPM）なので 60 RPM には当たらないはずだが、**どの制限（RPD / RPM / TPM）かは応答本文にしか出ず、当時のログには残っていなかった**
  - → `QuotaExceededError` に `detail` を持たせ、429本文から `quotaId` / `quotaMetric` / `retryDelay` を抜き出してログに出すようにした。**次の collect 実行でどの上限かが判明する**。ここが分かるまで `BATCH_SIZE` / `MAX_REQUESTS_PER_RUN` の再調整はしない（推測で動かすと何が効いたか分からなくなる）
- **空判定の記事が毎回候補に戻る問題が、想定より重い**（セッションノートの「次にやること2」）。`llm_tags: []` は `collect.ts:88` が全記事に書く既定値で、`store.ts:21` が旧データにも埋めるため、**「LLMが見て該当なしと判断した」と「一度も見ていない」を区別する情報がデータに無い**。候補の絞り込みは `llm_tags.length === 0`（`collect.ts:130`）なので、空判定の約106件は次回以降も永久に候補に戻る
  - クォータが律速になった今、これは「1〜2割の無駄」では済まない。**空判定は実行のたびに単調に増える**ので、放置すると予算のほとんどを「既に却下した記事の再判定」に使うようになる
  - → 処理済みフラグ（例: `llm_tagged_at`）の導入を、1を何巡か回す前に決めるべき状況に変わった

## レビュー（v0.5 実装分、A-1〜A-8）

- design.mdの実装順序どおりA-1→A-8を完走。各タスクの検証は実測値付きで上記に記録済み
- 主な成果:
  - fetcherをrss/HN/はてブ/arXivの4種に拡張、aggregator系はexisting記事へのmetricsマージ方式に対応（A-1〜A-4）
  - Conditional GET（ETag/If-Modified-Since）と7回連続失敗の可視化を実装（A-5）
  - mercari-engineeringのCI 403問題をIP起因と診断し無効化（A-6）
  - mixedソース向けdetectLanguageとhas_code判定を実装（A-7。has_codeは実データの都合で実測0件のままユーザー合意の上で先送り——cookpadに新着が出れば自然に解消する見込み）
  - ソースを8→29件（有効）に拡充、記事数464→3105件（A-8）
- 判断のためユーザー確認を挟んだ箇所: A-7のhas_code実測0件（実装維持の方針で合意）
- 既知の残課題（v0.5の範囲外・監視継続）:
  - `hatena-hotentry-it`・`arxiv-cs`がCI/ローカルで断続的にタイムアウトすることがある（A-5の失敗カウント機構が正しく追跡、7回連続には未達）
  - `shopify-engineering`はフィード仕様変更（HTMLへリダイレクト）によりA-8で無効化済み
- typecheck: 全パッケージ通過（各タスクで確認）。`pnpm build`もサイト側の大規模データ（3105記事）で899msで成功することを確認
- コミット: 2ced885〜464c242（A-1〜A-8、コード/データを分離してタスクごとに複数コミット）

## レビュー（v0 実装分）

- 初回収集で463記事（6ソース、2016年〜のバックフィル含む）。CI初回コミットで464件
- 発見して修正したバグ2件:
  1. 同一フィード内の同一URL重複（martinfowler の atom は記事更新ごとに同一リンクの
     エントリを持つ）→ フィード内 seen セットで排除
  2. CI で collect がハング（フェッチ失敗時に残るソケットがイベントループを維持。
     ローカルでは全ソース成功のため再現しなかった）→ 明示的 process.exit + timeout-minutes: 15
- 既知の問題: mercari-engineering が CI の IP からのみ 403（対処手順は design.md タスク A-6）
- コミット: 8b2ecd9（v0）、5347ada（CIハング修正）、52bfb6f（CI初回データ）
