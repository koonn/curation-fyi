import { collect } from "./collect.ts";
import { retag } from "./retag.ts";

const command = process.argv[2] ?? "collect";

switch (command) {
  case "collect":
    await collect();
    // フェッチ失敗時に残るソケットがイベントループを生かし続け、CIでハングするため明示的に終了する
    process.exit(process.exitCode ?? 0);
    break;
  case "retag":
    retag();
    process.exit(process.exitCode ?? 0);
    break;
  default:
    console.error(`不明なコマンド: ${command}（利用可能: collect, retag）`);
    process.exitCode = 1;
}
