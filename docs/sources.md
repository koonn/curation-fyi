# ソースの運用

ソースマスタは `data/sources.yaml`。有効/無効は `enabled`、収集の除外は `exclude` で指定する。

## exclude — 収集対象から外す

キュレーションの対象外（製品告知・リリースノート等）をソース単位のパターンで弾く。

```yaml
- id: vercel-blog
  # ...
  exclude:
    url_contains: ["/changelog/"]     # URL にこの文字列を含むものを除外
    title_matches: ["Changelog"]      # タイトルがこの正規表現に合うものを除外（大文字小文字は無視）
  enabled: true
```

- どちらか一方でも条件に合えば除外する
- `collect` は除外対象を**取り込まない**。件数は `✓ <id>: ... / 除外 N 件` としてログに出る
- 判定は `packages/pipeline/src/exclude.ts` の `isExcluded()` に集約してあり、収集と `prune` で同じ規則を使う

## prune — 既存記事を exclude 条件に揃える

`exclude` を足しただけでは、既に取り込んだ記事は残る。`prune` が消す。

```sh
pnpm prune-excluded --dry-run   # 件数だけ出す。何も書き込まない
pnpm prune-excluded             # 実行
```

その月の記事が0件になった場合は月ファイルごと削除する。
**pnpm の組み込みコマンド `pnpm prune` と衝突するため、スクリプト名は `prune-excluded`**（CLI サブコマンド名は `prune`）。

## 現在の除外設定（2026-08-16 時点）

| ソース | 条件 | 削除した既存記事 | 理由 |
|---|---|---:|---|
| vercel-blog | `url_contains: /changelog/` | 881 | 新機能・料金・提携の告知。技術記事は `/blog/` 側にある |
| discord-engineering | `title_matches: Changelog, Patch Notes` | 23 | アプリの更新告知 |

削除後の記事数は 3945 → **3041 件**（-22.9%）。

`discord-engineering` は名前に反して Discord の一般ブログで、
未タグ12件を判定した際に技術記事は `How We Moved Discord Voice to the Edge` の1本だけだった。
Changelog / Patch Notes を除いてもプロフィール機能の告知・提携発表などが残るが、
機械的に切れるパターンがないため今回は対象外にしている。ソースごと無効化するかは別途判断。

## Kaggle（fetcher: kaggle_api）

Kaggle に RSS は無い（Medium の旧ブログフィードは 2020-09 で停止、`/blog` は JS 描画、sitemap は 404）。
公式 API `https://api.kaggle.com/v1/<Service>/<Method>` に JSON を POST して取る。実装は `packages/pipeline/src/fetchers/kaggle.ts`。

| ソース | `kaggle.feed` | 呼ぶ API | 掲載先 |
|---|---|---|---|
| kaggle-blog | `blog` | `search.SearchApiService/ListEntities`（TOPIC 型を `writeUpTypes: ["BLOG"]` で絞る。新しい順） | Tech |
| kaggle-writeups | `writeups` | `discussions.DiscussionApiService/ListTopics`（HOT、解法 write-up カテゴリ） | Tech |
| kaggle-discussions | `discussions` | 同上（HOT、カテゴリ指定なし）＋ `min_votes` | Social |

### トークン

- 環境変数 `KAGGLE_API_TOKEN`（Bearer）。Kaggle の Settings → API → Create New Token で発行する
- CI では GitHub Secrets の `KAGGLE_API_TOKEN` を `collect.yml` が渡す
- 未設定のときは kaggle の3ソースだけが失敗（`KAGGLE_API_TOKEN が未設定`）し、他のソースは収集を続ける

### 落とし穴（2026-11-14 実測）

- 検索 API に `documentTypes: ["BLOG"]` を渡すと 400 `Unsupported document types: [Blog]`。
  Blog は内部で Writeup 扱いなので、TOPIC 型を Writeup の種別で絞る
- 検索 API の `HOTNESS` は**累計の人気**（2018年の入門 Exercise が上位）。「いま伸びている」は ListTopics の HOT で取る
- ListTopics は `pageSize` を大きくしても **20件で打ち切られ**、HOT には次ページが無い
- `votes` は 0 のとき項目ごと省かれる（`commentCount` も同様）
- Blog の記事パスは `discussionDocument.newCommentUrl`（`/blog/<slug>#<commentId>`）。`#` 以降は URL 正規化で落ちる
- hot Discussion に混ざる write-up は `/writeups/...` の URL で返るため、kaggle-writeups と URL で重複排除される

### min_votes（kaggle-discussions）

10 は**仮の値**。hot 20件のうち write-up を除く13件を目視して、10票以上で切るとノイズ1件（運営への要望）が残り、
良い投稿3件（9・3・3票）が落ちた。6時間ごとに hot を見直すので、hot にいる間に10票へ届けばその回で拾われる。
1〜2週間運用して入った実物を見て決め直す。ノイズが残るならタイトルの除外（`exclude.title_matches`）か LLM 判定を検討する。

### 入れていないもの

- Notebook（`kernels.KernelsApiService/ListKernels` の HOTNESS）: 提出用ノート・授業課題が多くノイズ過多
- Reddit r/kaggle: 宣伝・BAN の愚痴・募集が主体で Kaggle 上の話題を反映しない。UA 次第で 403 / 429
- Kaggle 公式 Bluesky: 2026-07-08 以降更新が無い
