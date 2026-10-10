import { SCHEMA_VERSION, type ExportRecord, type FetchReport } from "../schema";
import type { ThreadExport } from "./csv";

// Two JSON shapes, both with full per-thread metadata:
// flat (one array of rows, easiest to load into tools) and nested (replies under parents).

export interface ThreadMeta {
  source: string;
  thread_id: string;
  thread_title: string;
  permalink: string;
  fetch_path: FetchReport["path"];
  task_state: FetchReport["status"];
  stop_reason: FetchReport["stopReason"];
  fetched: number;
  known_unfetched_at_least: number;
  reported_by_source: number | null;
  fetched_at: string;
}

export interface NestedComment extends ExportRecord {
  replies: NestedComment[];
}

function meta({ records, report }: ThreadExport): ThreadMeta {
  const post = records.find((record) => record.record_type === "post")!;
  return {
    source: post.source,
    thread_id: post.thread_id,
    thread_title: post.thread_title,
    permalink: post.permalink,
    fetch_path: report.path,
    task_state: report.status,
    stop_reason: report.stopReason,
    fetched: report.fetched,
    known_unfetched_at_least: report.knownUnfetched,
    reported_by_source: report.reported,
    fetched_at: report.fetchedAt,
  };
}

const envelope = (threads: unknown[]) => ({
  schema_version: SCHEMA_VERSION,
  exported_at: new Date().toISOString(),
  generator: "Comment Scraper",
  threads,
});

export function toFlatJson(threads: ThreadExport[]): string {
  return JSON.stringify(
    envelope(threads.map((thread) => ({ meta: meta(thread), records: thread.records }))),
    null,
    2,
  );
}

/** Records are already in tree order (post, then depth-first), so one pass with a stack nests them. */
export function nestComments(records: ExportRecord[]): NestedComment[] {
  const roots: NestedComment[] = [];
  const byId = new Map<string, NestedComment>();
  for (const record of records) {
    if (record.record_type !== "comment") continue;
    const node: NestedComment = { ...record, replies: [] };
    byId.set(record.comment_id!, node);
    const parent = record.parent_id ? byId.get(record.parent_id) : undefined;
    (parent ? parent.replies : roots).push(node);
  }
  return roots;
}

export function toNestedJson(threads: ThreadExport[]): string {
  return JSON.stringify(
    envelope(
      threads.map((thread) => ({
        meta: meta(thread),
        post: thread.records.find((record) => record.record_type === "post"),
        comments: nestComments(thread.records),
      })),
    ),
    null,
    2,
  );
}
