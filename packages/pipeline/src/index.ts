import { collect } from "./collect.ts";

const command = process.argv[2] ?? "collect";

switch (command) {
  case "collect":
    await collect();
    break;
  default:
    console.error(`不明なコマンド: ${command}（利用可能: collect）`);
    process.exitCode = 1;
}
