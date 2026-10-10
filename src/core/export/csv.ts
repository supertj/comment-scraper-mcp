import type { ExportRecord, FetchReport } from "../schema";

// CSV for Excel and Google Sheets: UTF-8 with BOM, CRLF, RFC 4180 quoting.
// Several threads (batch export) go into one file; every row carries its thread's status.

export interface ThreadExport {
  records: ExportRecord[];
  report: FetchReport;
}

const COLUMNS = [
  "schema_version",
  "source",
  "record_type",
  "thread_id",
  "thread_title",
  "subreddit",
  "comment_id",
  "parent_id",
  "parent_missing",
  "depth",
  "score",
  "score_hidden",
  "created_utc",
  "edited_utc",
  "is_op",
  "comment_state",
  "body",
  "permalink",
  "task_state",
  "fetch_path",
  "fetched_at",
] as const;

/**
 * Formula injection guard for text cells only. Numbers stay numbers,
 * so a score of -5 is not turned into the text "'-5".
 */
export function escapeCsvText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return quote(escapeCsvText(String(value)));
}

export function toCsv(threads: ThreadExport[]): string {
  const lines = [COLUMNS.join(",")];
  for (const { records, report } of threads) {
    for (const record of records) {
      const row: Record<(typeof COLUMNS)[number], unknown> = {
        ...record,
        parent_missing: record.parent_missing ?? false,
        task_state: report.status,
        fetch_path: report.path,
        fetched_at: report.fetchedAt,
      };
      lines.push(COLUMNS.map((column) => cell(row[column])).join(","));
    }
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
