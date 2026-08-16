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
