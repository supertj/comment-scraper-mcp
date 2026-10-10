import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { commentNumbers, type ExportRecord, type FetchReport, type SourceId } from "./core/index.js";

// Finds Comment Scraper JSON exports in the folders it was pointed at (Downloads by default)
// and loads them. Read-only: it never writes, moves or deletes a file, and it makes no
// network requests. Exports are recognised by their content, not their file name, because
// the extension names files after the thread title.

export interface LoadedThread {
  /** "reddit:1abcxyz": stable across re-exports of the same thread. */
  id: string;
  title: string;
  source: SourceId;
  subreddit: string | null;
  permalink: string;
  file: string;
  /** Records in tree order: the post first, then comments depth-first. */
  records: ExportRecord[];
  report: FetchReport;
  /** comment_id → the number shown as [c12], the same numbering as the extension's Markdown. */
  numbers: Map<string, number>;
  /** How many other exports of the same thread were found (only the newest is used). */
  olderCopies: number;
}

/** Big enough for a 10,000-comment thread; anything larger is not one of our exports. */
const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** Our exports open with schema_version, exported_at and generator, so this is always enough. */
const SNIFF_BYTES = 512;
const MARKER = '"generator": "Comment Scraper"';

// Runtime checks: a file can carry our marker and still be truncated or hand-edited, and one
// bad file must not take down the tools for every other export.
const MetaShape = z.object({
  source: z.enum(["reddit", "hn"]),
  thread_id: z.string(),
  thread_title: z.string(),
  permalink: z.string(),
  fetch_path: z.enum(["json", "dom", "api"]),
  task_state: z.enum(["all_known_fetched", "partial", "limit_reached"]),
  stop_reason: z.string().nullable(),
  fetched: z.number(),
  known_unfetched_at_least: z.number(),
  reported_by_source: z.number().nullable(),
  fetched_at: z.string(),
});
type ThreadMetaJson = z.infer<typeof MetaShape>;

/** The fields the tools read; anything else on a record is passed through untouched. */
const RecordShape = z
  .object({
    record_type: z.enum(["post", "comment"]),
    comment_id: z.string().nullable(),
    parent_id: z.string().nullable(),
    score: z.number().nullable(),
    created_utc: z.string(),
    edited_utc: z.string().nullable(),
    is_op: z.boolean(),
    body: z.string(),
    permalink: z.string(),
    comment_state: z.string(),
    subreddit: z.string().nullable(),
  })
  .passthrough()
  .refine((record) => record.record_type === "post" || record.comment_id !== null);


const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Nested exports keep replies under their parent; walk them back into tree order. */
function flattenNested(post: unknown, comments: unknown): unknown[] | null {
  const records: unknown[] = [post];
  // Our nested exports always carry arrays (empty when there are no replies); anything else
  // means a damaged file, and a half-read thread must not replace a good older export.
  const walk = (nodes: unknown): boolean => {
    if (!Array.isArray(nodes)) return false;
    for (const node of nodes) {
      if (!isObject(node)) return false;
      const { replies, ...record } = node;
      records.push(record);
      if (!walk(replies)) return false;
    }
    return true;
  };
  return walk(comments) ? records : null;
}

/** Every record must have the fields the tools read, or the whole thread is skipped. */
function validRecords(raw: unknown[]): ExportRecord[] | null {
  for (const record of raw) if (!RecordShape.safeParse(record).success) return null;
  return raw as ExportRecord[];
}

function reportFrom(meta: ThreadMetaJson): FetchReport {
  return {
    fetched: meta.fetched,
    knownUnfetched: meta.known_unfetched_at_least,
    reported: meta.reported_by_source,
    status: meta.task_state,
    stopReason: meta.stop_reason as FetchReport["stopReason"],
    path: meta.fetch_path,
    requests: 0,
    fetchedAt: meta.fetched_at,
  };
}

/** Parses one file; returns [] for anything that isn't a Comment Scraper JSON export. */
export function parseExport(text: string, file: string): Omit<LoadedThread, "olderCopies">[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isObject(parsed) || parsed.generator !== "Comment Scraper" || !Array.isArray(parsed.threads)) return [];
  const threads: Omit<LoadedThread, "olderCopies">[] = [];
  for (const thread of parsed.threads) {
    if (!isObject(thread)) continue;
    const metaResult = MetaShape.safeParse(thread.meta);
    if (!metaResult.success) continue;
    const meta = metaResult.data;
    const raw = Array.isArray(thread.records) ? thread.records : thread.post !== undefined ? flattenNested(thread.post, thread.comments) : null;
    const records = raw ? validRecords(raw) : null;
    const post = records?.find((record) => record.record_type === "post");
    if (!records || !post) continue;
    threads.push({
      id: `${meta.source}:${meta.thread_id}`,
      title: meta.thread_title,
      source: meta.source,
      subreddit: post.subreddit,
      permalink: meta.permalink,
      file,
      records,
      report: reportFrom(meta),
      numbers: commentNumbers(records),
    });
  }
  return threads;
}

async function looksLikeExport(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").includes(MARKER);
  } finally {
    await handle.close();
  }
}

/** The folder itself and its direct subfolders, so exports moved into a project folder still count. */
async function jsonFilesIn(folder: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string, depth: number) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory() && depth === 0) await visit(path, 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) found.push(path);
    }
  };
  await visit(folder, 0);
  return found;
}

/**
 * The exports in a set of folders. Files are re-read only when their size or modification
 * time changes, so a client calling tools repeatedly doesn't re-parse a 5,000-comment export.
 */
export class Library {
  private cache = new Map<string, { signature: string; threads: Omit<LoadedThread, "olderCopies">[] }>();

  constructor(readonly folders: string[]) {}

  async threads(): Promise<LoadedThread[]> {
    const all: Omit<LoadedThread, "olderCopies">[] = [];
    const seen = new Set<string>();
    for (const folder of this.folders) {
      for (const path of await jsonFilesIn(folder)) {
        seen.add(path);
        let info;
        try {
          info = await stat(path);
        } catch {
          continue;
        }
        if (info.size > MAX_FILE_BYTES) continue;
        const signature = `${info.size}:${info.mtimeMs}`;
        const cached = this.cache.get(path);
        if (cached?.signature === signature) {
          all.push(...cached.threads);
          continue;
        }
        // An unreadable or vanished file (permissions, a download still in progress) is skipped,
        // not fatal: the other exports stay usable.
        let threads: Omit<LoadedThread, "olderCopies">[] = [];
        try {
          threads = (await looksLikeExport(path)) ? parseExport(await readFile(path, "utf8"), path) : [];
        } catch {
          threads = [];
        }
        this.cache.set(path, { signature, threads });
        all.push(...threads);
      }
    }
    for (const path of this.cache.keys()) if (!seen.has(path)) this.cache.delete(path);

    // The same thread exported twice: keep the newest fetch, and say how many older ones exist.
    const byId = new Map<string, LoadedThread>();
    for (const thread of all) {
      const current = byId.get(thread.id);
      if (!current) byId.set(thread.id, { ...thread, olderCopies: 0 });
      else if (thread.report.fetchedAt > current.report.fetchedAt) byId.set(thread.id, { ...thread, olderCopies: current.olderCopies + 1 });
      else current.olderCopies += 1;
    }
    return [...byId.values()].sort((a, b) => b.report.fetchedAt.localeCompare(a.report.fetchedAt));
  }
}
