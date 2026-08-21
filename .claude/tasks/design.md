# curation-fyi v0.5 / v1 設計書

実装者向け。この文書は判断を要しない粒度で書かれている。**判断が必要になったら実装を止めて質問すること**（自分で仕様を決めない）。全体計画の背景は `~/.claude/plans/jaunty-plotting-dragonfly.md`、v0の実装済み内容は git log と `.claude/tasks/todo.md` を参照。

## 現在の状態（2026-08-10 時点、実測）

- 記事 464 件（`cat data/articles/*.jsonl | wc -l`）、ソース 6 件、月別シャード 111 ファイル
- `pnpm collect` はローカル・CI とも成功（CI 実行時間 24 秒）
- CI（`.github/workflows/collect.yml`）は 6 時間ごとに収集し `data/` を自動コミットする
- 既知の問題: `mercari-engineering` は **CI の IP からのみ 403**（ローカルでは 200）。対処は「タスク A-6」参照

## 共通ルール

- 型はすべて `packages/shared/src/schema.ts` に置く。pipeline/site に型を重複定義しない
- 新しいタスクに着手する前に `git pull --rebase`（CI が 6 時間ごとに data/ へコミットするため）
- **`data/articles/*.jsonl` を手編集しない**。データ変更はパイプラインのコードからのみ行う
- 各タスクの「検証」をすべて実行し、**実測値を `.claude/tasks/todo.md` に記録してから**次のタスクへ進む。期待値と実測が食い違ったら実装を疑う前に期待値の根拠（この文書の該当節）を読み、それでも合わなければ質問する

---

# Phase v0.5 — 収集の完成

## タスク A-1: Fetcher インターフェースの整理と aggregator マージ

### 背景

HN・はてブは「他所の記事の人気度」を運ぶソースなので、独立した記事を作らず**同一 URL の既存記事に metrics をマージ**する。マージは既存 JSONL 行の書き換えを要するため、store に更新機能を追加する。

### スキーマ変更（shared/src/schema.ts）

`Article` に変更なし。`FetchedItem`（pipeline 側）を以下に拡張し、全 fetcher の戻り値型として共通化する:

```ts
export interface FetchedItem {
  url: string;            // normalizeUrl 適用済み
  title: string;
  summary: string | null;
  published_at: string;   // ISO 8601
  language: Language;
  external_ids?: ExternalIds;  // aggregator 系のみ設定
  metrics?: Metrics;           // aggregator 系のみ設定
}
```

### store.ts の変更

1. `loadExisting()` はそのまま（url → Article の Map）
2. 新関数 `saveAll(articles: Iterable<Article>): void` を追加:
   - 全記事を `published_at` の月（`YYYY-MM`）でグループ化
   - 各月ファイルを**全量書き直す**（追記ではない）。並び順は `published_at` 昇順、同値は `id` 昇順
   - 既存の `appendArticles` は削除し、collect は「Map を更新 → 変更のあった月だけ `saveAll` 対象にする」方式に変える。変更のあった月 = 新規記事の月 ∪ metrics が更新された記事の月
3. 決定性の保証: 同じ入力で 2 回実行したとき、2 回目の `git diff data/` が空になること

### collect.ts のマージ規則

各 FetchedItem について:

1. `existing.has(url)` が **false** → 新規 Article を作成（v0 と同じ。`external_ids`/`metrics` は item の値、無ければ `{}`）
2. `existing.has(url)` が **true** かつ item が `metrics` を持つ →
   - `article.metrics = { ...article.metrics, ...item.metrics }`（incoming が最新値として上書き）
   - `article.external_ids = { ...article.external_ids, ...item.external_ids }`
   - title/summary/published_at/source_id は**変更しない**（最初に取得した記事ソースが正）
3. `existing.has(url)` が **true** で metrics 無し → スキップ（v0 と同じ）

### 検証（A-1 完了条件）

- `pnpm collect` を 2 回連続実行 → 2 回目終了後 `git diff --stat data/` の出力が **metrics の値変動行のみ**（HN のポイントは実行間で動くことがある）または空
- `cat data/articles/*.jsonl | python3 -c "import sys,json; from collections import Counter; urls=[json.loads(l)['url'] for l in sys.stdin if l.strip()]; d=[u for u,c in Counter(urls).items() if c>1]; print(len(d))"` → **0**

## タスク A-2: HN fetcher（`fetchers/hackernews.ts`）

### API 仕様（2026-08-10 に実測確認済み）

- エンドポイント: `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50`
- 認証不要・レスポンスは JSON。`hits[]` の使用フィールド:
  `objectID`（文字列の数値。例 `"49234675"`）、`title`、`url`（**Ask HN 等では null**）、`points`（実測例 744）、`num_comments`（実測例 480）、`created_at`（ISO 8601、例 `"2026-08-09T19:16:49Z"`）

### マッピング規則

- `url === null` の hit は**スキップ**（自サイト内投稿は対象外）
- `url` → `normalizeUrl(hit.url)`
- `title` → `hit.title` / `summary` → `null` / `published_at` → `hit.created_at`
- `language` → `"en"` 固定
- `external_ids` → `{ hn_id: Number(hit.objectID) }`
- `metrics` → `{ hn_points: hit.points, hn_comments: hit.num_comments }`
- 取得は `fetch()` で行う（rss-parser 不使用）。HTTP ステータスが 200 以外なら throw

### sources.yaml 追記

```yaml
- id: hn-frontpage
  name: Hacker News Front Page
  type: aggregator
  language: en
  site_url: https://news.ycombinator.com/
  fetcher: hn_api
  enabled: true
```

（`feed_url` なし。collect.ts の fetcher 分岐に `hn_api` を追加）

### 検証（A-2 完了条件）

- `pnpm collect` 実行 → `✓ hn-frontpage: 新規 N 件`（N は 20〜50 の範囲）
- 検証コマンド: `grep -h hn_points data/articles/*.jsonl | wc -l` → **20 以上**
- CI（`gh workflow run collect` → 成功）でも同様に取得できること

## タスク A-3: はてなブックマーク fetcher（`fetchers/hatena.ts`）

### API 仕様（2026-08-10 に実測確認済み）

- エンドポイント: `https://b.hatena.ne.jp/hotentry/it.rss`
- 形式: RSS 1.0（RDF）。各 `<item>` に `<hatena:bookmarkcount>`（実測例 467, 93, 149）と `<dc:date>` を含む
- rss-parser で customFields を指定してパースする:

```ts
const parser = new Parser({
  customFields: { item: [["hatena:bookmarkcount", "bookmarkCount"], ["dc:date", "dcDate"]] },
});
```

### マッピング規則

- `url` → `normalizeUrl(item.link)` / `title` → `item.title`
- `summary` → `item.contentSnippet`（rss fetcher と同じ `toSummary` を共通化して使う。`fetchers/rss.ts` から export する）
- `published_at` → `item.dcDate`（無ければ item をスキップ）
- `language` → `"ja"` 固定
- `external_ids` → `{}`（はてブの eid はこの RSS に含まれないため設定しない。schema の `hatena_eid` は将来用に残す）
- `metrics` → `{ hatebu_count: Number(item.bookmarkCount) }`（数値化できなければ metrics 無し扱い）

### sources.yaml 追記

```yaml
- id: hatena-hotentry-it
  name: はてなブックマーク 人気エントリー（テクノロジー）
  type: aggregator
  language: ja
  site_url: https://b.hatena.ne.jp/hotentry/it
  feed_url: https://b.hatena.ne.jp/hotentry/it.rss
  fetcher: hatena_hotentry
  enabled: true
```

### 検証（A-3 完了条件）

- `pnpm collect` → `✓ hatena-hotentry-it: 新規 N 件`（N は 15〜30）
- `grep -h hatebu_count data/articles/*.jsonl | wc -l` → **15 以上**

## タスク A-4: arXiv fetcher（`fetchers/arxiv.ts`）

### API 仕様（2026-08-10 に実測確認済み）

- エンドポイント: `https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL+OR+cat:cs.SE&sortBy=submittedDate&sortOrder=descending&max_results=50`
- 形式: Atom（rss-parser でパース可能）。entry の `id` は `http://arxiv.org/abs/2608.07446v1` 形式（**バージョン接尾辞 vN 付き**）

### マッピング規則

- arXiv ID: entry.id から `abs/` 以降を取り、**`v\d+$` を除去**する（例 `2608.07446`）。改版で URL が変わって重複記事になるのを防ぐため
- `url` → `https://arxiv.org/abs/<version除去済みID>`（normalizeUrl も通す）
- `title` → 改行と連続空白を単一スペースに置換（arXiv の title は折り返し改行を含む）
- `summary` → entry の summary を `toSummary` で 300 字に切る
- `published_at` → entry の published（rss-parser では `isoDate`）
- `language` → `"en"` / `external_ids` → `{ arxiv_id: <version除去済みID> }` / `metrics` → なし
- **リクエスト間隔**: arXiv API の利用規約により 1 リクエスト/3 秒。現状 1 リクエストのみなので待機実装は不要だが、クエリを増やす場合は 3 秒 sleep を挟むこと

### sources.yaml 追記

```yaml
- id: arxiv-cs
  name: arXiv (cs.AI / cs.LG / cs.CL / cs.SE)
  type: paper
  language: en
  site_url: https://arxiv.org/
  fetcher: arxiv_api
  enabled: true
```

### 検証（A-4 完了条件）

- `pnpm collect` → `✓ arxiv-cs: 新規 N 件`（初回 N は 40〜50）
- `grep -h arxiv_id data/articles/*.jsonl | python3 -c "import sys; ls=sys.stdin.readlines(); import re; bad=[l for l in ls if re.search(r'arxiv_id\": \"[^\"]*v\d+\"', l)]; print(len(bad))"` → **0**（バージョン接尾辞が残っていない）

## タスク A-5: Conditional GET と失敗カウント

### feed-state.json（`data/state/feed-state.json`、git 管理する）

```json
{
  "<source_id>": {
    "etag": "文字列 or null",
    "last_modified": "文字列 or null",
    "consecutive_failures": 0,
    "last_success": "ISO 8601 or null"
  }
}
```

### rss fetcher の変更

1. `parser.parseURL` をやめ、`fetch()` + `parser.parseString()` に変える（レスポンスヘッダを読むため）
2. リクエストに state の `etag` → `If-None-Match`、`last_modified` → `If-Modified-Since` を付ける
3. レスポンス 304 → 空配列を返す（正常扱い、ログは `✓ <id>: 304 Not Modified`）
4. レスポンス 200 → `ETag`/`Last-Modified` ヘッダを state に保存
5. User-Agent は現行の `curation-fyi/0.1 (+https://github.com/koonn/curation-fyi)` を維持

### 失敗カウント

- ソース成功時: `consecutive_failures = 0`、`last_success` 更新
- ソース失敗時: `consecutive_failures += 1`
- collect 終了時、`consecutive_failures >= 7` のソースがあれば:
  - 環境変数 `GITHUB_STEP_SUMMARY` が存在する場合（=CI）、そのファイルに `## 収集失敗が継続しているソース` の見出しとソース一覧（id・連続失敗回数・最終成功日時）を追記
  - issue 自動起票は**実装しない**（v1 でも実装しない。job summary で十分と判断済み。理由: 起票の重複管理コストが個人運用に見合わない）

### 検証（A-5 完了条件）

- `pnpm collect` を 2 回連続実行 → 2 回目のログに `304 Not Modified` が **1 件以上**（ETag を返すソースがある。cookpad = はてなブログ系は ETag 対応）
- `data/sources.yaml` の 1 ソースの feed_url を存在しない URL に変えて 7 回実行 → `feed-state.json` の該当 `consecutive_failures` が **7** になり、`GITHUB_STEP_SUMMARY=/tmp/summary.md pnpm collect` で `/tmp/summary.md` に見出しが出力される。**検証後は feed_url を戻し、consecutive_failures を 0 に戻すため正常実行を 1 回行う**

## タスク A-6: mercari 403 の対処

手順（この順に実行）:

1. `fetchers/rss.ts` の User-Agent をブラウザ風（`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36`）に変えた**一時ブランチ**を push し、`gh workflow run collect --ref <ブランチ>` で実行
2. ログで `✓ mercari-engineering` になれば: UA 起因。ただし bot を名乗らない UA への恒久変更はしない（行儀の問題）。mercari のみ `sources.yaml` に `user_agent:` フィールド（Source 型に optional 追加）を持たせて上書きする
3. まだ `✗ 403` なら: IP 起因（GitHub ランナーの IP レンジをWAFがブロック）。`enabled: false` にし、name の横にコメント `# CIのIPが403になるため無効化（2026-08-10 診断）` を残す
4. 一時ブランチは削除する

### 検証（A-6 完了条件）

- main の CI 実行で `✗ mercari` のログ行が**出ない**こと（✓ になるか、ソースが無効化されているか、いずれか）

## タスク A-7: 言語判定と has_code

### 言語判定（`normalize.ts` に追加）

- 依存追加: `tinyld`（pipeline のみ）
- 関数 `detectLanguage(text: string, fallback: Language): Language`
  - `tinyld` の `detect()` に `title + " " + (summary ?? "")` を渡す
  - 戻り値が `"ja"` → `"ja"`、それ以外すべて → `"en"`（本サイトの言語軸は 2 値。zh や ko も en 側に倒す。これは決定済みの仕様）
- 適用対象: `source.language === "mixed"` のソースのみ。既存の具体値ソース（ja/en）はフィード既定値をそのまま使う（判定しない）
- 現時点で mixed ソースは存在しない。実装とテストのみ行う

### has_code 判定（rss fetcher 内）

- rss-parser の item に `content:encoded`（rss-parser では `item["content:encoded"]`、customFields 指定が必要）または `content` があれば、その HTML に対して `/<pre[\s>]|<code[\s>]/` をテストし true/false を設定
- 本文フィールドが無いフィードでは `null` のまま（**記事ページの追加フェッチはしない**。決定済み: 全記事フェッチは行儀とコストの問題で不採用）

### 検証（A-7 完了条件）

- `tinyld` の単体確認: `pnpm --filter @curation-fyi/pipeline exec tsx -e "import {detect} from 'tinyld'; console.log(detect('プロンプトエンジニアリングの基礎'), detect('How to build agents'))"` → `ja en`
- 収集済み全件で `language` フィールド欠落 0 件: `grep -hL '"language"' data/articles/*.jsonl | wc -l` → **0**
- has_code: `grep -h '"has_code": true' data/articles/*.jsonl | wc -l` → **1 以上**（jxck / cookpad のフィードは本文全文を含むため）

## タスク A-8: 企業・個人ブログのソース拡充

### 候補リスト

以下を上から順に処理する。**フィード URL はここに書かれていても未検証**。1 件ずつ次の手順で登録する:

1. `curl -s -o /dev/null -w "%{http_code}" -L -A "curation-fyi/0.1" "<feed候補URL>"` → 200 を確認。404 なら サイトの HTML `<link rel="alternate" type="application/rss+xml">` からフィード URL を探す。見つからなければそのソースはスキップし、todo.md に「フィードなし」と記録
2. sources.yaml に追記（type/language は下表のとおり）して `pnpm collect` → `✓ <id>` を確認
3. ✗ になったらエラーメッセージを todo.md に記録して `enabled: false`

| id | name | type | lang | feed候補URL |
|---|---|---|---|---|
| github-engineering | The GitHub Blog (Engineering) | company_blog | en | https://github.blog/engineering/feed/ |
| netflix-techblog | Netflix TechBlog | company_blog | en | https://netflixtechblog.com/feed |
| uber-engineering | Uber Engineering | company_blog | en | https://www.uber.com/en-US/blog/engineering/rss/ |
| airbnb-engineering | Airbnb Engineering | company_blog | en | https://medium.com/feed/airbnb-engineering |
| slack-engineering | Slack Engineering | company_blog | en | https://slack.engineering/feed/ |
| spotify-engineering | Spotify Engineering | company_blog | en | https://engineering.atspotify.com/feed |
| dropbox-tech | Dropbox Tech | company_blog | en | https://dropbox.tech/feed |
| shopify-engineering | Shopify Engineering | company_blog | en | https://shopify.engineering/blog.atom |
| meta-engineering | Engineering at Meta | company_blog | en | https://engineering.fb.com/feed/ |
| linkedin-engineering | LinkedIn Engineering | company_blog | en | https://www.linkedin.com/blog/engineering.rss |
| discord-engineering | Discord Engineering | company_blog | en | https://discord.com/blog/rss.xml |
| vercel-blog | Vercel Blog | company_blog | en | https://vercel.com/atom |
| anthropic-news | Anthropic | company_blog | en | https://www.anthropic.com/rss.xml |
| line-yahoo-tech | LINEヤフー Tech Blog | company_blog | ja | https://techblog.lycorp.co.jp/ja/feed/index.xml |
| cyberagent-developers | CyberAgent Developers Blog | company_blog | ja | https://developers.cyberagent.co.jp/blog/feed/ |
| hatena-developer | Hatena Developer Blog | company_blog | ja | https://developer.hatenastaff.com/rss |
| zozo-techblog | ZOZO TECH BLOG | company_blog | ja | https://techblog.zozo.com/rss |
| moneyforward-dev | Money Forward Developers Blog | company_blog | ja | https://moneyforward-dev.jp/rss |
| smarthr-tech | SmartHR Tech Blog | company_blog | ja | https://tech.smarthr.jp/feed |
| dena-engineering | DeNA Engineering | company_blog | ja | https://engineering.dena.com/index.xml |
| freee-developers | freee Developers Hub | company_blog | ja | https://developers.freee.co.jp/rss |
| simonwillison | Simon Willison's Weblog | personal_blog | en | https://simonwillison.net/atom/everything/ |
| overreacted | overreacted (Dan Abramov) | personal_blog | en | https://overreacted.io/rss.xml |
| naoya | naoyaのはてなダイアリー系 | personal_blog | ja | （手順1で探す） |
| azukiazusa | azukiazusaのテックブログ | personal_blog | ja | https://azukiazusa.dev/rss.xml |

### 検証（A-8 完了条件）

- 有効ソース数 **25 以上**（`python3 -c "import yaml; print(sum(1 for s in yaml.safe_load(open('data/sources.yaml')) if s['enabled']))"`）
- `pnpm collect` で失敗ソース **0**（無効化済みを除く）
- 総記事数 **900 件以上**（目安。25 ソース × 平均 20〜30 件 + 既存 464）

---

# Phase v1 — タグ付けと UI

## タスク B-1: ルールベースタグ付け

### taxonomy/tags.yaml（新規作成。この内容をそのまま使う）

```yaml
# tag slug → 表示名と検出キーワード。
# en キーワードは単語境界マッチ（大文字小文字無視）、ja キーワードは部分文字列マッチ。
- slug: llm
  name: LLM / 生成AI
  keywords_en: [LLM, GPT, Claude, Gemini, "generative AI", prompt, RAG, agent, agentic, transformer, "fine-tuning", embedding]
  keywords_ja: [生成AI, プロンプト, エージェント, 大規模言語モデル, ファインチューニング]
- slug: machine-learning
  name: 機械学習
  keywords_en: ["machine learning", "deep learning", "neural network", pytorch, tensorflow, inference, training]
  keywords_ja: [機械学習, 深層学習, ニューラルネット, 推論, 学習]
- slug: frontend
  name: フロントエンド
  keywords_en: [React, Vue, Svelte, CSS, TypeScript, JavaScript, browser, DOM, frontend, "web components", Next.js, Astro]
  keywords_ja: [フロントエンド, ブラウザ]
- slug: backend
  name: バックエンド
  keywords_en: [API, microservice, gRPC, GraphQL, backend, "server-side", REST]
  keywords_ja: [バックエンド, マイクロサービス]
- slug: infrastructure
  name: インフラ / SRE
  keywords_en: [Kubernetes, Docker, container, terraform, SRE, reliability, observability, monitoring, incident, deploy, CI/CD]
  keywords_ja: [インフラ, 監視, 信頼性, 障害, デプロイ, コンテナ]
- slug: database
  name: データベース
  keywords_en: [PostgreSQL, MySQL, SQLite, Redis, database, "query optimization", index, transaction]
  keywords_ja: [データベース, クエリ, インデックス, トランザクション]
- slug: security
  name: セキュリティ
  keywords_en: [security, vulnerability, CVE, authentication, authorization, encryption, XSS, CSRF]
  keywords_ja: [セキュリティ, 脆弱性, 認証, 認可, 暗号]
- slug: performance
  name: パフォーマンス
  keywords_en: [performance, latency, throughput, optimization, benchmark, profiling, cache, caching]
  keywords_ja: [パフォーマンス, 高速化, レイテンシ, キャッシュ, 最適化]
- slug: mobile
  name: モバイル
  keywords_en: [iOS, Android, Swift, Kotlin, "React Native", Flutter, mobile]
  keywords_ja: [モバイル, アプリ開発]
- slug: data-engineering
  name: データエンジニアリング
  keywords_en: ["data pipeline", Spark, Kafka, BigQuery, Snowflake, ETL, "data warehouse", analytics]
  keywords_ja: [データ基盤, データパイプライン, 分析基盤]
- slug: programming-language
  name: プログラミング言語
  keywords_en: [Rust, Go, Golang, Python, Ruby, Java, compiler, "type system"]
  keywords_ja: [コンパイラ, 型システム]
- slug: architecture
  name: 設計 / アーキテクチャ
  keywords_en: [architecture, "design pattern", refactoring, "domain-driven", modular, monolith]
  keywords_ja: [設計, アーキテクチャ, リファクタリング, ドメイン駆動]
- slug: team-process
  name: チーム / プロセス
  keywords_en: [hiring, onboarding, "code review", "engineering culture", productivity, agile, management]
  keywords_ja: [組織, 採用, チーム, 開発生産性, マネジメント, スクラム]
- slug: paper
  name: 論文
  keywords_en: []
  keywords_ja: []
```

### マッチング仕様（`tagger/rules.ts`）

- 対象テキスト: `title + " " + (summary ?? "")`
- en キーワード: `new RegExp("\\b" + escapeRegExp(kw) + "\\b", "i")`。**ただしキーワードに空白・記号を含む場合も同じ式でよい**（`\b` は先頭末尾にのみ付く）
- ja キーワード: `text.includes(kw)`（大文字小文字は関係ない）
- 1 つでもマッチしたタグの slug を `article.tags` に入れる（重複なし、taxonomy 記載順）
- 特例: `source.type === "paper"` の記事には無条件で `paper` タグを付与する
- `source.default_tags` はマッチ結果に union する

### retag コマンド（`src/index.ts` にサブコマンド追加）

- `pnpm --filter @curation-fyi/pipeline exec tsx src/index.ts retag`
- 全記事の `tags` を上記規則で**再計算して上書き**し、`saveAll` で保存する
- ルート package.json に `"retag": "pnpm --filter @curation-fyi/pipeline retag"` を追加

### 検証（B-1 完了条件）

- `retag` 実行後、タグ 1 個以上の記事の割合を測る: 期待 **60% 以上**（ルールのみでの実測目安。95% は B-2 の LLM 併用後の目標）
- 測定コマンドを todo.md に実測値と共に記録:
  `cat data/articles/*.jsonl | python3 -c "import sys,json; arts=[json.loads(l) for l in sys.stdin if l.strip()]; tagged=sum(1 for a in arts if a['tags']); print(f'{tagged}/{len(arts)} = {tagged/len(arts):.1%}')"`
- `retag` を 2 回連続実行 → 2 回目の `git diff data/` が**空**（決定性）

## タスク B-2: LLM タグ付け・要約

### スキーマ変更

`Article` に `llm_tags: string[]` を追加（既存データは読み込み時に `?? []` で補完し、次回 saveAll で永続化）。表示用タグは `union(tags, llm_tags)`（site 側で計算）。

### 実装（`tagger/llm.ts`）

> **この節は Issue #6（2026-08-21）で失効した。** 実装は Anthropic 1記事1リクエストから
> **Gemini 無料枠 + 25件バッチ**に載せ替わっており、環境変数も `GEMINI_API_KEY` に変わっている。
> 現行の仕様は `docs/tagging.md`、実測値と判断の経緯は `.claude/tasks/todo.md` を見ること。
> 以下は当初の設計として残す。

- 依存: `@anthropic-ai/sdk`（pipeline のみ）
- 対象: `article.tags.length === 0 && article.llm_tags.length === 0` の記事のみ
- 1 実行あたり上限 **100 記事**（定数 `MAX_LLM_PER_RUN = 100`）。超過分は次回実行に回る
- モデル: `claude-haiku-4-5-20251001`、`max_tokens: 300`
- 環境変数 `ANTHROPIC_API_KEY` が**未設定なら何もせずスキップ**（ログ: `LLMタグ付け: APIキー未設定のためスキップ`）。CI には GitHub Secrets で設定する（ユーザーに依頼すること。実装者は設定しない）
- プロンプト（この文言をそのまま使う。`{tags}` は taxonomy の slug と name の一覧、`{title}`/`{summary}` は記事の値）:

```
以下の技術記事に合うタグを、タグ一覧から0〜3個選んでください。
どれにも合わなければ空配列にしてください。JSONのみを出力してください。

タグ一覧:
{tags}

記事タイトル: {title}
記事要約: {summary}

出力形式: {"tags": ["slug1", "slug2"]}
```

- レスポンスは JSON.parse し、taxonomy に存在する slug のみ採用（存在しない slug は捨てる）。parse 失敗はその記事をスキップしてログに記録（リトライしない）
- collect の最後（タグ付け段階）に組み込む。呼び出し順: ルールベース → 残りが LLM 対象

### 検証（B-2 完了条件）

- ANTHROPIC_API_KEY を設定してローカルで 1 回実行 → ログに `LLMタグ付け: N 件処理`（N ≤ 100）
- タグ付与率（tags ∪ llm_tags が 1 個以上）: **95% 以上**（B-1 のコマンドを llm_tags 込みに変えて測定・記録）
- コスト実測: 実行ログに概算トークン数を出力し（usage フィールドを合算）、100 記事で **$0.15 未満**（実測根拠: 入力 ~500 トークン + 出力 ~100 トークン/記事、Haiku $1/MTok 入力・$5/MTok 出力）

## タスク B-3: サイトのページ拡充

### 前提の変更

- `load-articles.ts` に `loadTagMap()`（taxonomy/tags.yaml 読み込み）を追加
- 記事の表示用タグ = `[...new Set([...a.tags, ...(a.llm_tags ?? [])])]`
- ページング: **1 ページ 20 件**。ページ番号は 1 始まり

### ルート一覧（Astro の getStaticPaths で静的生成）

| ルート | 内容 | 並び |
|---|---|---|
| `/` | 新着 100 件 + フィルタバー（B-4） | published_at 降順 |
| `/hot/` | 直近 7 日（`published_at >= now-7d`）のうち `score > 0` を score 降順で最大 50 件。`score = (metrics.hn_points ?? 0) + (metrics.hatebu_count ?? 0)` | score 降順 |
| `/sources/` | ソース一覧（有効のみ。名前・種別・記事数） | 記事数降順 |
| `/sources/[id]/[page]/` | ソース別記事 | published_at 降順 |
| `/tags/[slug]/[page]/` | タグ別記事（表示用タグで判定） | published_at 降順 |
| `/archive/[page]/` | 全記事 | published_at 降順 |
| `/feed.xml` | 新着 50 件の RSS 2.0（Astro エンドポイント。`@astrojs/rss` を使う） | published_at 降順 |

- `[page]` 系の 1 ページ目は `/sources/[id]/1/` のような URL でよい（リダイレクト・エイリアス不要。シンプル優先で決定済み）
- ビルド時間の期待値: 現状データ（~1000 記事、25 ソース、14 タグ）で **60 秒以内**

### 検証（B-3 完了条件）

- `pnpm build` 成功、`dist/` 配下の HTML ファイル数 **100 以上**（`find packages/site/dist -name "*.html" | wc -l`）
- `/hot/index.html` に hn_points 由来のバッジが 1 件以上表示される
- `curl` 不要（静的ファイルの中身を grep で確認）: `grep -l "hot" packages/site/dist/index.html` 等でナビゲーションリンクの存在確認
- `dist/feed.xml` が `<rss` で始まり `<item>` を 50 個含む

## タスク B-4: フィルタバー island

### 実装

- Preact island（`@astrojs/preact` を site に追加）。ファイル: `components/FilterBar.tsx`
- ビルド時に `public/api/recent.json` ではなく **`src/pages/recent.json.ts`**（Astro エンドポイント）で直近 90 日の記事メタデータを生成:

```ts
// 1件あたりのフィールド（これ以外を含めない）
{ u: url, t: title, d: published_at(YYYY-MM-DD), l: language, s: source_id, g: 表示用タグ配列, c: has_code }
```

- FilterBar の状態: 言語（all/en/ja）、タグ（単一選択）、has_code（true のみ絞り込みトグル）、ソース種別（all/company_blog/personal_blog/aggregator/paper）
- 言語選択は `localStorage` キー `curation-fyi:lang` に保存し、次回訪問時に復元
- フィルタ適用時はトップの記事一覧（サーバー生成分）を hidden にし、recent.json から클라イアント側で再描画。フィルタ解除で元に戻す
- 90 日分を超える探索は `/archive/` と `/search/` へ誘導するリンクを結果末尾に置く

### 検証（B-4 完了条件）

- `dist/recent.json` の gzip サイズ **500KB 以下**: `gzip -c packages/site/dist/recent.json | wc -c`
- `pnpm dev` でブラウザ確認: 言語 ja 選択 → 一覧が ja のみになる。リロード → 選択が保持される（この 2 点は目視。スクリーンショットを todo.md 完了記録に添付）

## タスク B-5: Pagefind 検索

### 実装

- site に `pagefind` を devDependency 追加。build スクリプトを `astro build && pagefind --site dist` に変更
- `/archive/[page]/` の記事要素に `data-pagefind-body` を付与（インデックス対象は archive のみ。トップ等は `data-pagefind-ignore`）
- 各記事要素に `data-pagefind-meta="url[href]"` 相当の設定でリンク先を外部 URL にする（Pagefind の結果クリックで記事原文へ飛ぶこと。Pagefind のデフォルトはページ内リンクなので、`data-pagefind-meta` で外部 URL をメタに載せ、検索 UI 側でメタの URL を使う）
- `/search/` ページに Pagefind UI（`@pagefind/default-ui`）を設置

### 検証（B-5 完了条件）

- ビルド後 `dist/pagefind/` が存在する
- `pnpm preview` で `/search/` を開き、既知の記事タイトルの一部（en: `Cloudflare`、ja: `メルカリ`）で検索してヒットすること（目視確認・記録）

---

# 実装順序と引き継ぎ

- 順序: A-1 → A-2 → A-3 → A-4 → A-5 → A-6 → A-7 → A-8 →（ここで v0.5 完了報告）→ B-1 → B-2 → B-3 → B-4 → B-5
- 各タスク完了ごとに 1 コミット（データ再生成が伴う場合はコードとデータを分けて 2 コミット）。コミットメッセージは `feat(pipeline): A-2 HN fetcher` の形式
- CI が並行して data/ にコミットするため、push 前に必ず `git pull --rebase`
- 検証の実測値はすべて `.claude/tasks/todo.md` に記録する。**期待値と一致しない場合は先へ進まず質問する**
