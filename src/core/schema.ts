// Export schema v1. Shared by every source, every fetch path
// and every export format. There is deliberately no author field anywhere.

export const SCHEMA_VERSION = 1 as const;

export type SourceId = "reddit" | "hn";
export type RecordType = "post" | "comment";
export type CommentState = "normal" | "deleted" | "removed";
export type FetchPath = "json" | "dom" | "api";

/**
 * three outcomes. The UI must never call a result "complete" —
 * `all_known_fetched` only means the parser found no unexpanded nodes.
 */
export type ResultStatus = "all_known_fetched" | "partial" | "limit_reached";

export type StopReason =
  | "comment_limit"
  | "request_limit"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "not_json"
  | "unauthorized"
  | "user_stopped"
  | "source_disabled"
  | "tab_closed"
  | "session_changed"
  /** DOM path only: "continue this thread" links navigate away and cannot be expanded in place. */
  | "unexpandable"
  /** JSON path only: Reddit listed these comments but returned none of them when asked (usually just deleted). */
  | "not_returned"
  /** DOM path only: selectors match neither new nor old Reddit — likely a redesign. */
  | "layout_unknown"
  /** The day's request allowance ran out mid-thread; the task resumes tomorrow. */
  | "daily_limit";

export interface ExportRecord {
  schema_version: typeof SCHEMA_VERSION;
  source: SourceId;
  record_type: RecordType;
  thread_id: string;
  thread_title: string;
  /** Reddit only; null for other sources. */
  subreddit: string | null;
  /** null for the post row. IDs are always strings: Reddit's new IDs are up to 13 chars and not monotonic. */
  comment_id: string | null;
  /** null for the post row; top-level comments point at thread_id. */
  parent_id: string | null;
  /** Set only when the parent comment was not fetched. */
  parent_missing?: true;
  /** null for the post row; top-level comments are 0. */
  depth: number | null;
  /** null when the source hides or does not expose a score. */
  score: number | null;
  score_hidden: boolean;
  /** ISO 8601, UTC. */
  created_utc: string;
  edited_utc: string | null;
  is_op: boolean;
  /** JSON path: the source's raw Markdown. DOM path: plain text, links as "text (URL)". Empty for deleted/removed. */
  body: string;
  permalink: string;
  comment_state: CommentState;
}

/** The three numbers the UI shows: fetched F, known-unfetched-at-least R, source-reported N. */
export interface FetchCounts {
  fetched: number;
  knownUnfetched: number;
  reported: number | null;
}

export interface FetchReport extends FetchCounts {
  status: ResultStatus;
  stopReason: StopReason | null;
  path: FetchPath;
  requests: number;
  fetchedAt: string;
}

export interface FetchLimits {
  maxComments: number;
  maxRequests: number;
}

export function toIsoFromEpochSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}
