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
