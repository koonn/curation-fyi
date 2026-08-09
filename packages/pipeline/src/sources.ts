import fs from "node:fs";
import { parse } from "yaml";
import type { Source } from "@curation-fyi/shared";
import { SOURCES_FILE } from "./paths.ts";

export function loadSources(): Source[] {
  const raw = parse(fs.readFileSync(SOURCES_FILE, "utf8")) as Source[];
  const seen = new Set<string>();
  for (const s of raw) {
    if (!s.id || !s.name || !s.type || !s.fetcher) {
      throw new Error(`sources.yaml: 必須フィールド欠落: ${JSON.stringify(s)}`);
    }
    if (seen.has(s.id)) {
      throw new Error(`sources.yaml: id重複: ${s.id}`);
    }
    seen.add(s.id);
  }
  return raw.filter((s) => s.enabled);
}
