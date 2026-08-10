import fs from "node:fs";
import { FEED_STATE_FILE, STATE_DIR } from "./paths.ts";

export interface SourceState {
  etag: string | null;
  last_modified: string | null;
  consecutive_failures: number;
  last_success: string | null;
}

export type FeedState = Record<string, SourceState>;

export function defaultSourceState(): SourceState {
  return { etag: null, last_modified: null, consecutive_failures: 0, last_success: null };
}

export function loadFeedState(): FeedState {
  if (!fs.existsSync(FEED_STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(FEED_STATE_FILE, "utf8")) as FeedState;
}

export function saveFeedState(state: FeedState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(FEED_STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}
