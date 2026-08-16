import fs from "node:fs";
import { parse } from "yaml";
import type { Source } from "@curation-fyi/shared";
import { SOURCES_FILE } from "./paths.ts";

/** 無効化済みを含む全ソース。既存記事の source を引くときに使う */
export function loadAllSources(): Source[] {
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
  return raw;
}

/** 収集対象（enabled のみ） */
export function loadSources(): Source[] {
  return loadAllSources().filter((s) => s.enabled);
}
