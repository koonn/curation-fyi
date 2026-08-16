# タグ付けの運用

記事のタグは3段階で決まる。表示用タグは `union(tags, llm_tags)`。

| 段階 | 書き込む先 | 実行者 | いつ走るか |
|---|---|---|---|
| ① ルールベース | `tags` | `pnpm collect` / `pnpm retag` | 毎回（決定的・冪等） |
| ② LLM（APIキーあり） | `llm_tags` | `pnpm collect` | `ANTHROPIC_API_KEY` があるときだけ、1回100件まで |
| ③ 手動（APIキーなし） | `llm_tags` | `pnpm tag-export` → 編集 → `pnpm tag-import` | 人が回したいとき |

②と③は**同じフィールドに書く同じ仕事**で、どちらか一方があればよい。
`ANTHROPIC_API_KEY` を持たない運用では③が正規の手順になる。

## ① ルールベース

`taxonomy/tags.yaml` のキーワードで `title + " " + summary` を判定する。
en キーワードは単語境界マッチ（大文字小文字無視）、ja キーワードは部分文字列マッチ。
`source.type === "paper"` の記事には無条件で `paper` を、`source.default_tags` は union する。

```sh
pnpm retag   # 全記事の tags を再計算して上書きする（llm_tags は触らない）
```

決定的なので、2回続けて実行すれば2回目の `git diff data/` は空になる。

## ② LLM（APIキーがある場合）

`pnpm collect` のタグ付け段階に組み込まれている。`tags` も `llm_tags` も空の記事を
新しい順に最大100件、`claude-haiku-4-5` に投げる。`ANTHROPIC_API_KEY` が未設定なら
`LLMタグ付け: APIキー未設定のためスキップ` を出して何もしない。

CI で動かすには repo の GitHub Secrets に `ANTHROPIC_API_KEY` を設定する。
設定しなければ CI では②が常にスキップされ、③だけが効く。

## ③ 手動（APIキーがない場合の正規手順）

**1. 未タグ記事を書き出す**

```sh
pnpm tag-export --limit 100     # 既定100件。data/tagging/pending.jsonl に出る（git管理外）
```

出力は1行1記事の JSONL。`tags` が空で出てくる。

```json
{"url":"...","title":"...","summary":"...","source_id":"...","language":"ja","tags":[]}
```

対象は②と同じ「`tags` も `llm_tags` も空の記事」で、並びは新しい順
（サイトのトップに出る記事から埋まるようにしている）。要約は読みやすさのため300字で切る。

**2. `tags` を埋める**

`taxonomy/tags.yaml` の slug を0〜3個。**どのタグにも合わなければ空のままにする**。
人がやってもよいし、Claude Code のセッションにこのファイルを読ませて埋めさせてもよい。
利用可能な slug は `tag-export` が実行時に一覧を出す。

**3. 取り込む**

```sh
pnpm tag-import
```

- taxonomy にない slug が1つでもあれば**何も書き込まずにエラーで止まる**（typo を握り潰さない）
- 取り込んだタグは taxonomy 記載順に正規化されて `llm_tags` に入る
- **`tags` が空の行は「未判定」として扱われ、何も書き込まれない**。
  「どのタグにも合わない」と「まだ見ていない」を区別する手段がないため、
  空のまま取り込むと次回の `tag-export` にまた出てくる（下記の既知の課題）

### ソースを絞る

```sh
pnpm tag-export --source vercel-blog --limit 12 --file data/tagging/vercel-blog.jsonl
pnpm tag-import --file data/tagging/vercel-blog.jsonl
```

`--source` はカンマ区切りで複数指定できる。`--file` の相対パスはリポジトリルート基準。

## 既知の課題: 空判定の記事が毎回出てくる

②③とも対象条件が「`tags` も `llm_tags` も空」なので、
**「どのタグにも合わない」と判定された記事は次回も対象に戻る**。

2026-08-16 に手動で **136件**（新着100件＋未タグ上位3ソースからの層化抽出36件）を判定した実測:

| ソース | 空 | 計 | 空判定率 | 空の中身 |
|---|---:|---:|---:|---|
| discord-engineering | 10 | 12 | 83% | Changelog / Patch Notes / 提携告知 |
| hn-frontpage | 42 | 64 | 66% | 心臓病・エルニーニョ・スポーツ等の一般ニュース |
| vercel-blog | 8 | 13 | 62% | `/changelog/` の製品告知 |
| hatena-hotentry-it | 18 | 32 | 56% | 家電レビュー・政治・防災アプリ等 |
| simonwillison | 1 | 2 | 50% | 野鳥の観察記録 |
| jxck | 0 | 12 | **0%** | — |
| **合計** | **79** | **136** | **58%** | |

空判定は2種類に分かれ、対処も別になる。

**(a) そもそも技術記事でない**（hn-frontpage・hatena-hotentry-it）
この2つは技術限定ではない集約サイトなので構造的に混ざる。

**(b) 技術ドメインだが製品告知**（vercel-blog の `/changelog/`、discord-engineering の Changelog / Patch Notes）
製品告知は本サイトの対象外とする方針。**タグ付けではなく収集/表示の段階で切るべきもの**で、
現に vercel-blog の `/changelog/` 881件のうち **529件は既にルールベースでタグが付いており**、
タグ付け段階だけを直しても表示からは消えない。

見分けの手掛かり（少数標本なので確定ではない）:
- vercel-blog は URL で分かれる。未タグの `/changelog/` 8件は全て製品告知、`/blog/` 4件は全て技術記事だった。
  ただしコーパス全体の未タグ率は `/changelog/` 40% / `/blog/` 41% とほぼ同じで、
  「ルールが両方に同じくらい効いている」だけかもしれない
- discord-engineering はタイトルの `Changelog` / `Patch Notes` で23件（全102件の23%）が機械的に分かれる。
  そもそもこのソースは engineering ブログではなく Discord の一般ブログで、技術記事は稀

### (b) は解決済み（2026-08-16）

製品告知はキュレーション対象外とする方針が決まり、収集段階で除外するようにした。
`data/sources.yaml` の `exclude` と `pnpm prune-excluded` で、904件を削除済み。
詳細は `docs/sources.md`。

### (a) は未解決

残る対処案:

1. 処理済みフラグ（`llm_tagged_at` 等）を `Article` に足し、対象条件を「未処理かつ `tags` 0個」に変える
   — 「毎回同じ記事を判定し直す」問題そのものの解決
2. `taxonomy/tags.yaml` に受け皿のタグ（ハードウェア・科学・ビジネス等）を足す
   — (a) を拾いにいく場合。ただしキュレーションの対象を広げる判断になる
3. hn-frontpage / hatena-hotentry-it 自体の扱いを見直す
   — この2つは技術限定ではない集約サイトで、空判定の主因

design.md の B-2 完了条件「付与率95%以上」は、上記のいずれかを入れないと到達できない
（製品告知の除外後も付与率は58.8%でほぼ変わらなかった。削除した904件のタグ付与率が
コーパス全体とほぼ同じだったため）。
