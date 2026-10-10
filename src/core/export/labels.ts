import type { FetchReport, SourceId } from "../schema";

export function sourceLabel(source: SourceId): string {
  return source === "reddit" ? "Reddit" : "Hacker News";
}

/** Never says "complete". */
export function describeStatus(report: Pick<FetchReport, "status" | "stopReason">): string {
  if (report.status === "all_known_fetched") return "all known comments fetched";
  if (report.status === "limit_reached") return `stopped at plan limit (${report.stopReason ?? "limit"})`;
  return `partial (${report.stopReason ?? "unknown reason"})`;
}
