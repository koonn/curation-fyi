import { collect } from "./collect.ts";
import { retag } from "./retag.ts";
import { exportUntagged, importTags } from "./tagger/manual.ts";
import { prune } from "./prune.ts";

const [, , command = "collect", ...rest] = process.argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

switch (command) {
  case "collect":
    await collect();
    // フェッチ失敗時に残るソケットがイベントループを生かし続け、CIでハングするため明示的に終了する
    process.exit(process.exitCode ?? 0);
    break;
  case "retag":
    retag(rest.includes("--llm-reset"));
    process.exit(process.exitCode ?? 0);
    break;
  case "tag-export": {
    const limit = flag("limit");
    const sources = flag("source")?.split(",").filter(Boolean);
    exportUntagged(limit === undefined ? undefined : Number(limit), flag("file"), sources);
    process.exit(process.exitCode ?? 0);
    break;
  }
  case "tag-import":
    importTags(flag("file"));
    process.exit(process.exitCode ?? 0);
    break;
  case "prune":
    prune(rest.includes("--dry-run"));
    process.exit(process.exitCode ?? 0);
    break;
  default:
    console.error(`不明なコマンド: ${command}（利用可能: collect, retag, tag-export, tag-import, prune）`);
    process.exitCode = 1;
}
