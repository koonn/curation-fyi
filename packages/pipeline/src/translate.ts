import { isLlmEnabled, LlmRunner } from "./llm/gemini.ts";
import { loadExisting, saveAll } from "./store.ts";
import { fetchBodies, MIN_USABLE_SUMMARY } from "./translator/body.ts";
import { translateCandidates, translateWithLlm } from "./translator/llm.ts";

interface TranslateOptions {
  limit?: number;
  sources?: string[];
  dryRun?: boolean;
  /** フィードに要約が無い記事について、リンク先の本文を取りに行く（HN 向け） */
  fetchBodies?: boolean;
  /** サマリが3行に満たない記事も対象に戻す（材料が増えたときの作り直し） */
  redoShort?: boolean;
  /** 全件を作り直す。前回の値は信用せず上書きする（照合が無かった頃の出力の入れ替え用） */
  redoAll?: boolean;
}

/**
 * 英語記事に和訳見出しと3行サマリを付ける単独実行。
 * collect に組み込まれた分と同じジョブを、件数とソースを絞って走らせる。
 * dryRun のときは保存せず結果を標準出力に出す（品質を目視で確かめるための経路）。
 */
export async function translate({
  limit,
  sources,
  dryRun,
  fetchBodies: shouldFetchBodies,
  redoShort,
  redoAll,
}: TranslateOptions): Promise<void> {
  if (!isLlmEnabled()) {
    console.error("translate: GEMINI_API_KEY が未設定のため実行できない");
    process.exitCode = 1;
    return;
  }

  const existing = loadExisting();
  let candidates = translateCandidates(existing.values(), { redoShort, redoAll });
  if (sources?.length) candidates = candidates.filter((a) => sources.includes(a.source_id));
  const total = candidates.length;
  if (limit !== undefined) candidates = candidates.slice(0, limit);

  console.log(
    `translate: 候補 ${total} 件のうち ${candidates.length} 件を処理する` +
      (sources?.length ? `（ソース: ${sources.join(", ")}）` : "") +
      (dryRun ? " ※dry-run（保存しない）" : ""),
  );
  const noSummary = candidates.filter((a) => !a.summary).length;
  console.log(`  うち要約がフィードに無い（タイトルのみ）記事: ${noSummary} 件`);

  // 取得の失敗でリクエスト予算を無駄にしないよう、LLM を呼ぶ前にまとめて取りに行く。
  // 取れなかった記事は「タイトルのみ」として同じバッチに乗る（従来どおりサマリは空になる）
  const bodies = shouldFetchBodies ? (await fetchBodies(candidates)).bodies : new Map<string, string>();

  // やり直しの対象のうち、前回より良い材料が無いものは投げても結果が変わらない。
  // リクエスト予算を使わずに落とす（一度も処理していない記事は見出しのために残す）。
  // 「良い材料がある」＝本文が取れた、または元から使える長さの要約を持っている
  if (redoShort && !redoAll && shouldFetchBodies) {
    const before = candidates.length;
    candidates = candidates.filter(
      (a) =>
        !a.title_ja ||
        bodies.has(a.url) ||
        (a.summary !== null && a.summary.length >= MIN_USABLE_SUMMARY),
    );
    if (before !== candidates.length) {
      console.log(`  やり直しのうち材料が増えていない ${before - candidates.length} 件を除外した`);
    }
  }

  const runner = new LlmRunner();
  const { updated } = await translateWithLlm(candidates, runner, bodies, { force: redoAll });

  // 目視用の出力。原文と和訳を並べる
  for (const [n, a] of updated.entries()) {
    console.log(`\n──── ${n + 1}. ${a.source_id}${a.summary ? "" : " ※タイトルのみ"}`);
    console.log(`  原題  : ${a.title}`);
    console.log(`  和訳  : ${a.title_ja}`);
    if (a.summary_ja?.length) {
      for (const line of a.summary_ja) console.log(`  ・${line}`);
    } else {
      console.log("  （サマリなし）");
    }
  }

  if (dryRun) {
    console.log("\ndry-run のため保存しなかった");
    return;
  }
  const changedMonths = new Set(updated.map((a) => a.published_at.slice(0, 7)));
  const toSave = [...existing.values()].filter((a) => changedMonths.has(a.published_at.slice(0, 7)));
  saveAll(toSave);
  console.log(`\n保存した（書き直した月 ${changedMonths.size} 個）`);
}
