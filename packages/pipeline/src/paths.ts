import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "../../..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const ARTICLES_DIR = path.join(DATA_DIR, "articles");
export const SOURCES_FILE = path.join(DATA_DIR, "sources.yaml");
export const STATE_DIR = path.join(DATA_DIR, "state");
export const FEED_STATE_FILE = path.join(STATE_DIR, "feed-state.json");
export const TAXONOMY_FILE = path.join(REPO_ROOT, "taxonomy", "tags.yaml");
/** 手動タグ付けの作業ファイル置き場（git管理しない） */
export const TAGGING_DIR = path.join(DATA_DIR, "tagging");
export const TAGGING_FILE = path.join(TAGGING_DIR, "pending.jsonl");
