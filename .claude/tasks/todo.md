# curation-fyi v0 実装 TODO

計画: `~/.claude/plans/jaunty-plotting-dragonfly.md`（承認済み）

## v0（最小動作）

- [ ] git init + pnpm workspace 初期化
- [ ] packages/shared: Article/Source 型定義
- [ ] data/sources.yaml: RSSソース5本（フィードURLは実フェッチで検証してから登録）
- [ ] packages/pipeline: rss fetcher + URL正規化 + 重複排除 + JSONL追記 + collect CLI
- [ ] packages/site: Astro トップページ（新着100件一覧）
- [ ] .github/workflows/collect.yml（cron 6時間ごと）
- [ ] 検証: `pnpm collect` 2回実行で重複0件（`jq .url | sort | uniq -d` 空）
- [ ] 検証: 1ソースの feed_url を故意に壊して他ソースが成功すること
- [ ] 検証: `pnpm build` でサイトが生成され記事一覧が表示されること
- [ ] GitHub public repo 作成 + push（ユーザー確認後）
- [ ] Cloudflare Pages 接続（ユーザー操作が必要）

## レビュー

（完了時に記載）
