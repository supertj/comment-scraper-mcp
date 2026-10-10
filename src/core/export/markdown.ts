import type { ExportRecord, FetchReport } from "../schema";
import { describeStatus, sourceLabel } from "./labels";

// Markdown laid out for a language model: every comment gets a stable
// number like [c12] so an answer can cite it, and each reply names its parent ("reply to
// [c3]"). Comments aren't indented by depth (2026-10-05): Markdown viewers drop a 2-space
// indent and turn 4 spaces into a code block, and the explicit parent already gives the tree.

export interface MarkdownOptions {
  /** Prepended as-is; used by "copy with prompt". */
  prompt?: string;
}

export function relativeTime(fromIso: string, nowIso: string): string {
  const seconds = Math.max(0, (Date.parse(nowIso) - Date.parse(fromIso)) / 1000);
  const units: [number, string][] = [
    [365 * 86400, "y"],
    [30 * 86400, "mo"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [size, label] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${label} ago`;
  }
  return "just now";
}

/** Neutralises lines that would otherwise become headings or open a code fence. */
export function escapeMarkdownLine(line: string): string {
  return /^\s*(#|```|~~~)/.test(line) ? line.replace(/^(\s*)/, "$1\\") : line;
}

export function commentNumbers(records: ExportRecord[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let next = 1;
  for (const record of records) {
    if (record.record_type === "comment" && record.comment_id) numbers.set(record.comment_id, next++);
  }
  return numbers;
}

export function toMarkdown(records: ExportRecord[], report: FetchReport, options: MarkdownOptions = {}): string {
  const post = records.find((record) => record.record_type === "post");
  if (!post) return "";
  const numbers = commentNumbers(records);
  const now = report.fetchedAt;
  const lines: string[] = [];

  if (options.prompt) lines.push(options.prompt.trim(), "", "---", "");

  lines.push(`# ${post.thread_title.replace(/\s+/g, " ").trim()}`, "");
  const where = post.subreddit ? `${sourceLabel(post.source)} · r/${post.subreddit}` : sourceLabel(post.source);
  lines.push(`- Source: ${where} · ${post.permalink}`);
  lines.push(`- Exported: ${report.fetchedAt} · fetch path: ${report.path} · status: ${describeStatus(report)}`);
  lines.push(
    `- Comments: ${report.fetched} fetched · at least ${report.knownUnfetched} known but not fetched · ${
      report.reported ?? "unknown"
    } reported by the source`,
  );
  lines.push("- Comment numbers like [c12] are references within this file. Scores can be null when hidden.", "");

  lines.push(`## Post (score ${post.score ?? "hidden"}, ${relativeTime(post.created_utc, now)})`, "");
  if (post.comment_state !== "normal") lines.push(`(${post.comment_state})`);
  else if (post.body) lines.push(...post.body.split("\n").map(escapeMarkdownLine));
  lines.push("", "## Comments", "");

  for (const record of records) {
    if (record.record_type !== "comment") continue;
    lines.push(...commentLines(record, numbers, now), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/**
 * One comment as it appears in the Markdown export: "[c12] reply to [c3] (score 41, 3d ago, OP)"
 * then the body. Shared with the MCP server so both number and format comments the same way.
 */
export function commentLines(record: ExportRecord, numbers: Map<string, number>, now: string): string[] {
  const number = numbers.get(record.comment_id!);
  const meta = [`score ${record.score ?? "hidden"}`, relativeTime(record.created_utc, now)];
  if (record.is_op) meta.push("OP");
  if (record.edited_utc) meta.push("edited");
  const parentNumber = record.parent_id ? numbers.get(record.parent_id) : undefined;
  const replyTo = parentNumber ? ` reply to [c${parentNumber}]` : record.parent_missing ? " reply to a comment not fetched" : "";
  const lines = [`[c${number}]${replyTo} (${meta.join(", ")})`];
  if (record.comment_state !== "normal") lines.push(`(${record.comment_state})`);
  else for (const line of record.body.split("\n")) lines.push(escapeMarkdownLine(line));
  return lines;
}
