import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { commentLines, describeStatus, escapeMarkdownLine, sourceLabel, type ExportRecord } from "./core/index.js";
import type { Library, LoadedThread } from "./library.js";

// Four read-only tools over the exports the Library finds. Comments are numbered [c1], [c2]…
// exactly as in the extension's Markdown export, so a quote Claude cites can be found in the
// file the user downloaded.

export const VERSION = "0.1.2";

/** Keeps one tool result well inside what MCP clients accept (Claude Code warns above ~25k tokens). */
const MAX_RESULT_CHARS = 60_000;
const READ_LIMIT_DEFAULT = 200;
const READ_LIMIT_MAX = 500;
const SEARCH_LIMIT_DEFAULT = 30;
const EXCERPT_CHARS = 400;

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

/** Cuts one oversized block (a very long comment) so a single item can't break the budget. */
function clip(block: string, max: number): string {
  return block.length > max ? `${block.slice(0, max)}… (cut here: this item is longer than one response allows)` : block;
}

/** Takes blocks in order until the character budget is spent; reports how many didn't fit. */
function fit(blocks: string[], budget: number): { shown: string[]; omitted: number } {
  const shown: string[] = [];
  let used = 0;
  for (const block of blocks) {
    const piece = clip(block, budget);
    if (shown.length && used + piece.length > budget) break;
    shown.push(piece);
    used += piece.length + 2;
  }
  return { shown, omitted: blocks.length - shown.length };
}
const fail = (value: string) => ({ content: [{ type: "text" as const, text: value }], isError: true });

function comments(thread: LoadedThread): ExportRecord[] {
  return thread.records.filter((record) => record.record_type === "comment");
}

function where(thread: LoadedThread): string {
  return thread.subreddit ? `r/${thread.subreddit}` : sourceLabel(thread.source);
}

function countsLine(thread: LoadedThread): string {
  const { report } = thread;
  const reported = report.reported === null ? `${sourceLabel(thread.source)} doesn't report a total` : `${report.reported} reported by ${sourceLabel(thread.source)}`;
  return `${report.fetched} fetched, at least ${report.knownUnfetched} known but not fetched, ${reported}; ${describeStatus(report)}`;
}

function noExportsMessage(library: Library): string {
  return [
    `No Comment Scraper exports found in: ${library.folders.join(", ")}.`,
    "Export a thread from the Comment Scraper side panel as JSON (\"JSON, one row per comment\" or \"JSON, replies nested\") and it will show up here.",
    "Exports in another folder: start the server with --dir <folder>.",
  ].join("\n");
}

/** A thread by its id ("reddit:1abc") or by words from its title. */
function resolve(threads: LoadedThread[], query: string): LoadedThread | string {
  const exact = threads.find((thread) => thread.id === query.trim());
  if (exact) return exact;
  const needle = query.trim().toLowerCase();
  const matches = threads.filter((thread) => thread.title.toLowerCase().includes(needle));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) return `No exported thread matches "${query}". Call list_threads to see what's available.`;
  const listed = matches.slice(0, 20).map((thread) => `- ${thread.id}: ${clip(thread.title, 200)}`).join("\n");
  const more = matches.length > 20 ? `\n…and ${matches.length - 20} more. Use more words from the title.` : "";
  return `"${query}" matches ${matches.length} threads. Use one of these ids:\n${listed}${more}`;
}

/** "c12", "[c12]" or "12" → 12. */
function refNumber(ref: string): number | null {
  const match = /^\[?c?(\d+)\]?$/i.exec(ref.trim());
  return match ? Number(match[1]) : null;
}

export function createServer(library: Library): McpServer {
  const server = new McpServer({ name: "comment-scraper", version: VERSION });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "list_threads",
    {
      title: "List exported threads",
      description:
        "Lists the Reddit and Hacker News threads the user exported with Comment Scraper, newest first, with comment counts. Call this first to get a thread id.",
      inputSchema: { query: z.string().optional().describe("Only threads whose title contains this text") },
      annotations: readOnly,
    },
    async ({ query }) => {
      const threads = await library.threads();
      if (!threads.length) return text(noExportsMessage(library));
      const shown = query ? threads.filter((thread) => thread.title.toLowerCase().includes(query.toLowerCase())) : threads;
      if (!shown.length) return text(`No exported thread title contains "${query}". ${threads.length} threads are available without the filter.`);
      const blocks = shown.map((thread) =>
        [
          `- id: ${thread.id}`,
          `  title: ${thread.title}`,
          `  ${where(thread)}, exported ${thread.report.fetchedAt.slice(0, 10)}`,
          `  ${countsLine(thread)}`,
          thread.olderCopies ? `  (${thread.olderCopies} older export${thread.olderCopies === 1 ? "" : "s"} of this thread ignored)` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      const { shown: listed, omitted } = fit(blocks, MAX_RESULT_CHARS);
      const more = omitted ? `\n\n${omitted} more threads not shown. Pass query with words from a title to narrow the list.` : "";
      return text(`${shown.length} exported thread${shown.length === 1 ? "" : "s"}:\n\n${listed.join("\n\n")}${more}`);
    },
  );

  server.registerTool(
    "read_thread",
    {
      title: "Read a thread",
      description:
        "Returns a thread's post and comments as numbered Markdown ([c12] reply to [c3] (score 41, 3d ago)). Long threads come in pages: call again with the offset given at the end. Cite comments by their [cN] number.",
      inputSchema: {
        thread: z.string().describe("Thread id from list_threads, or words from its title"),
        offset: z.number().int().min(0).optional().describe("Skip this many comments (for the next page)"),
        limit: z.number().int().min(1).max(READ_LIMIT_MAX).optional().describe(`Comments per page, default ${READ_LIMIT_DEFAULT}`),
        min_score: z.number().int().optional().describe("Only comments with at least this score (hidden scores are left out)"),
      },
      annotations: readOnly,
    },
    async ({ thread: query, offset = 0, limit = READ_LIMIT_DEFAULT, min_score }) => {
      const threads = await library.threads();
      if (!threads.length) return text(noExportsMessage(library));
      const thread = resolve(threads, query);
      if (typeof thread === "string") return fail(thread);

      const all = comments(thread);
      const pool = min_score === undefined ? all : all.filter((record) => record.score !== null && record.score >= min_score);
      const post = thread.records.find((record) => record.record_type === "post")!;
      const now = thread.report.fetchedAt;
      const lines = [
        `# ${thread.title}`,
        "",
        `${where(thread)} · ${thread.permalink}`,
        countsLine(thread),
        `Exported ${now}. Comment numbers like [c12] match the Markdown export of this thread.`,
        "",
      ];
      if (offset === 0) {
        lines.push(`## Post (score ${post.score ?? "hidden"})`, "", post.comment_state !== "normal" ? `(${post.comment_state})` : post.body ? clip(post.body.split("\n").map(escapeMarkdownLine).join("\n"), Math.floor(MAX_RESULT_CHARS / 3)) : "(no text)", "");
      }
      lines.push("## Comments", "");

      let used = lines.join("\n").length;
      let index = offset;
      for (; index < pool.length && index < offset + limit; index++) {
        const block = clip([...commentLines(pool[index]!, thread.numbers, now), ""].join("\n"), Math.max(2_000, MAX_RESULT_CHARS - used));
        // Stop at the size budget rather than cutting a comment in half.
        if (used + block.length > MAX_RESULT_CHARS && index > offset) break;
        lines.push(block);
        used += block.length + 1;
      }
      const filterNote = min_score === undefined ? "" : ` with score ≥ ${min_score}`;
      lines.push(
        index < pool.length
          ? `Showing comments ${offset + 1}–${index} of ${pool.length}${filterNote}. Call read_thread again with offset=${index} for more.`
          : `Showing comments ${Math.min(offset + 1, pool.length)}–${pool.length} of ${pool.length}${filterNote}. That's the end of the thread.`,
      );
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "search_comments",
    {
      title: "Search comments",
      description:
        "Finds comments containing all of the given words across every exported thread (or one thread). Returns each match with its thread, [cN] number and score.",
      inputSchema: {
        query: z.string().min(1).describe("Words to look for; a comment must contain all of them (case-insensitive)"),
        thread: z.string().optional().describe("Limit to one thread: id or words from its title"),
        limit: z.number().int().min(1).max(100).optional().describe(`Maximum matches, default ${SEARCH_LIMIT_DEFAULT}`),
      },
      annotations: readOnly,
    },
    async ({ query, thread: threadQuery, limit = SEARCH_LIMIT_DEFAULT }) => {
      let threads = await library.threads();
      if (!threads.length) return text(noExportsMessage(library));
      if (threadQuery) {
        const thread = resolve(threads, threadQuery);
        if (typeof thread === "string") return fail(thread);
        threads = [thread];
      }
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits: { thread: LoadedThread; record: ExportRecord }[] = [];
      for (const thread of threads) {
        for (const record of comments(thread)) {
          if (record.comment_state !== "normal") continue;
          const body = record.body.toLowerCase();
          if (words.every((word) => body.includes(word))) hits.push({ thread, record });
        }
      }
      if (!hits.length) return text(`No comment contains all of: ${words.join(", ")}.`);
      // Highest score first: the comments readers agreed with most.
      hits.sort((a, b) => (b.record.score ?? -Infinity) - (a.record.score ?? -Infinity));
      const shown = hits.slice(0, limit).map(({ thread, record }) => {
        const body = record.body.length > EXCERPT_CHARS ? `${record.body.slice(0, EXCERPT_CHARS)}…` : record.body;
        return `- ${thread.title} (${thread.id}) [c${thread.numbers.get(record.comment_id!)}], score ${record.score ?? "hidden"}\n  ${body.replace(/\n+/g, " ")}\n  ${record.permalink}`;
      });
      const { shown: fitted, omitted } = fit(shown, MAX_RESULT_CHARS);
      const notShown = hits.length - fitted.length;
      const more = notShown ? `\n\n${notShown} more matches not shown. Narrow the words or limit the search to one thread.` : "";
      return text(`${hits.length} matching comment${hits.length === 1 ? "" : "s"}, highest score first:\n\n${fitted.join("\n\n")}${more}`);
    },
  );

  server.registerTool(
    "get_comment",
    {
      title: "Get a comment in context",
      description: "Returns one comment by its [cN] number with the comments it replies to (up to the top) and its direct replies.",
      inputSchema: {
        thread: z.string().describe("Thread id from list_threads, or words from its title"),
        comment: z.string().describe('Comment number, e.g. "c12" or "12"'),
      },
      annotations: readOnly,
    },
    async ({ thread: query, comment }) => {
      const threads = await library.threads();
      if (!threads.length) return text(noExportsMessage(library));
      const thread = resolve(threads, query);
      if (typeof thread === "string") return fail(thread);
      const number = refNumber(comment);
      const all = comments(thread);
      const target = number === null ? undefined : all.find((record) => thread.numbers.get(record.comment_id!) === number);
      if (!target) return fail(`"${comment}" isn't a comment in this export. Numbers run from c1 to c${all.length}.`);

      const byId = new Map(all.map((record) => [record.comment_id!, record]));
      // Nearest parent first; a malformed export with a parent loop stops at the first repeat.
      const ancestors: ExportRecord[] = [];
      const visited = new Set<string>([target.comment_id!]);
      for (let parent = target.parent_id ? byId.get(target.parent_id) : undefined; parent && !visited.has(parent.comment_id!); parent = parent.parent_id ? byId.get(parent.parent_id) : undefined) {
        visited.add(parent.comment_id!);
        ancestors.push(parent);
      }
      const replies = all.filter((record) => record.parent_id === target.comment_id);
      const now = thread.report.fetchedAt;
      const block = (record: ExportRecord) => commentLines(record, thread.numbers, now).join("\n");
      // A third of the budget each: the comment itself, the chain above it, the replies below.
      const third = Math.floor(MAX_RESULT_CHARS / 3);
      const above = fit(ancestors.map(block), third);
      const below = fit(replies.map(block), third);
      const sections = [
        `# ${thread.title}`,
        ancestors.length
          ? `## Replying to\n\n${[...above.shown].reverse().join("\n\n")}${above.omitted ? `\n\n(${above.omitted} earlier comments in this chain not shown)` : ""}`
          : target.depth === 0
            ? "## Top-level comment"
            : "## Replying to a comment that isn't in this export",
        `## The comment\n\n${clip(block(target), third)}\n${target.permalink}`,
        replies.length
          ? `## Direct replies (${replies.length})\n\n${below.shown.join("\n\n")}${below.omitted ? `\n\n(${below.omitted} more replies not shown)` : ""}`
          : "## No replies in this export",
      ];
      return text(sections.join("\n\n"));
    },
  );

  return server;
}
