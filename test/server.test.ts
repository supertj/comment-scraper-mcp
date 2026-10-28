import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SCHEMA_VERSION, toFlatJson, toMarkdown, toNestedJson, type ExportRecord, type FetchReport } from "../src/core/index.js";
import { Library } from "../src/library";
import { createServer } from "../src/server";

// Exports are written with the extension's own serialisers, so these tests fail if the
// file format and the MCP reader ever drift apart.

const now = "2026-10-10T12:00:00.000Z";
const ago = (hours: number) => new Date(Date.parse(now) - hours * 3_600_000).toISOString();

function thread(id: string, title: string, bodies: Array<[string, string | null, number | null, string]>, fetchedAt = now) {
  const base = {
    schema_version: SCHEMA_VERSION,
    source: "reddit" as const,
    thread_id: id,
    thread_title: title,
    subreddit: "smallbusiness",
    score_hidden: false,
    edited_utc: null,
    is_op: false,
    comment_state: "normal" as const,
  };
  const records: ExportRecord[] = [
    { ...base, record_type: "post", comment_id: null, parent_id: null, depth: null, score: 50, created_utc: ago(48), body: "# Which CRM?\nWe are four people.", permalink: `https://www.reddit.com/r/smallbusiness/comments/${id}/` } as ExportRecord,
  ];
  const depth = new Map<string, number>();
  for (const [commentId, parent, score, body] of bodies) {
    const level = parent ? (depth.get(parent) ?? 0) + 1 : 0;
    depth.set(commentId, level);
    records.push({ ...base, record_type: "comment", comment_id: commentId, parent_id: parent ?? id, depth: level, score, created_utc: ago(24), body, permalink: `https://www.reddit.com/r/smallbusiness/comments/${id}/_/${commentId}/` } as ExportRecord);
  }
  const report: FetchReport = { fetched: bodies.length, knownUnfetched: 0, reported: bodies.length, status: "all_known_fetched", stopReason: null, path: "json", requests: 1, fetchedAt };
  return { records, report };
}

const crm = thread("crm1", "Which CRM do small teams actually stick with?", [
  ["a1", null, 214, "We left our CRM after the renewal doubled."],
  ["a2", "a1", 88, "Ask for the year-two price in writing."],
  ["a3", "a2", 31, "The export button was the first thing they hid."],
  ["a4", null, null, "Email sync is what made us stay. Renewal was fine."],
]);
const pricing = thread("price1", "Raising prices as a freelancer", [["b1", null, 12, "I raised my renewal rate by 20% and nobody left."]]);
const crmOlder = thread("crm1", "Which CRM do small teams actually stick with?", [["a1", null, 1, "old copy"]], ago(72));

let dir: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}, on: Client = client) {
  const result = (await on.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: result.content[0]!.text, isError: Boolean(result.isError) };
}

async function clientFor(folder: string): Promise<Client> {
  const server = createServer(new Library([folder]));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const connected = new Client({ name: "test", version: "1.0.0" });
  await connected.connect(clientSide);
  return connected;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cs-mcp-"));
  writeFileSync(join(dir, "which-crm.json"), toFlatJson([crm]));
  mkdirSync(join(dir, "project"));
  writeFileSync(join(dir, "project", "pricing.json"), toNestedJson([pricing]));
  writeFileSync(join(dir, "which-crm-old.json"), toFlatJson([crmOlder]));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "not-an-export" }));
  writeFileSync(join(dir, "broken.json"), '{"schema_version": 1, "generator": "Comment Scraper", "threads": [');
  client = await clientFor(dir);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("comment-scraper-mcp", () => {
  it("offers four read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["get_comment", "list_threads", "read_thread", "search_comments"]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
  });

  it("lists flat and nested exports, newest copy only, and ignores other JSON", async () => {
    const { text } = await call("list_threads");
    expect(text).toContain("2 exported threads");
    expect(text).toContain("reddit:crm1");
    expect(text).toContain("reddit:price1");
    expect(text).toContain("1 older export of this thread ignored");
    expect(text).not.toContain("old copy");
  });

  it("numbers comments exactly like the extension's Markdown export", async () => {
    const { text } = await call("read_thread", { thread: "reddit:crm1" });
    const markdown = toMarkdown(crm.records, crm.report);
    for (const line of ["[c1] (score 214, 1d ago)", "[c2] reply to [c1] (score 88, 1d ago)", "[c3] reply to [c2] (score 31, 1d ago)", "[c4] (score hidden, 1d ago)"]) {
      expect(text).toContain(line);
      expect(markdown).toContain(line);
    }
    expect(text).toContain("\\# Which CRM?");
    expect(text).toContain("Showing comments 1–4 of 4. That's the end of the export.");
    expect(text).not.toContain("end of the thread");
    expect(text).not.toContain("not of the thread");
  });

  it("pages long threads and filters by score", async () => {
    const first = await call("read_thread", { thread: "which crm", limit: 2 });
    expect(first.text).toContain("Showing comments 1–2 of 4. Call read_thread again with offset=2");
    const second = await call("read_thread", { thread: "which crm", offset: 2, limit: 2 });
    expect(second.text).toContain("[c3]");
    expect(second.text).not.toContain("## Post");
    const popular = await call("read_thread", { thread: "which crm", min_score: 80 });
    expect(popular.text).toContain("of 2 with score ≥ 80");
    expect(popular.text).not.toContain("[c4]");
  });

  it("searches all threads for comments containing every word, highest score first", async () => {
    const { text } = await call("search_comments", { query: "renewal" });
    expect(text).toContain("3 matching comments");
    expect(text.indexOf("[c1], score 214")).toBeLessThan(text.indexOf("[c1], score 12"));
    const both = await call("search_comments", { query: "renewal fine" });
    expect(both.text).toContain("1 matching comment");
    expect(both.text).toContain("[c4], score hidden");
  });

  it("returns a comment with the replies above and below it", async () => {
    const { text } = await call("get_comment", { thread: "reddit:crm1", comment: "[c2]" });
    expect(text.indexOf("## Replying to")).toBeLessThan(text.indexOf("[c1] (score 214"));
    expect(text).toContain("## The comment\n\n[c2] reply to [c1]");
    expect(text).toContain("## Direct replies (1)");
    const missing = await call("get_comment", { thread: "reddit:crm1", comment: "c99" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("c1 to c4");
  });

  it("asks for a specific id when a title matches several threads", async () => {
    const { text, isError } = await call("read_thread", { thread: "r" });
    expect(isError).toBe(true);
    expect(text).toContain("matches 2 threads");
  });

  it("explains how to export when the folder has no exports", async () => {
    const empty = mkdtempSync(join(tmpdir(), "cs-mcp-empty-"));
    const server = createServer(new Library([empty]));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const other = new Client({ name: "test", version: "1.0.0" });
    await other.connect(clientSide);
    const result = (await other.callTool({ name: "list_threads", arguments: {} })) as { content: Array<{ text: string }> };
    expect(result.content[0]!.text).toContain("No Comment Scraper exports found");
    expect(result.content[0]!.text).toContain("--dir");
    rmSync(empty, { recursive: true, force: true });
  });
});

// The last page must not let a model think it has read the whole thread when the export stops short.
describe("the end of an incomplete export", () => {
  const withReport = (base: ReturnType<typeof thread>, report: Partial<FetchReport>) => ({ ...base, report: { ...base.report, ...report } });
  const partial = withReport(
    thread("part1", "Partial thread", [
      ["p1", null, 9, "First."],
      ["p2", "p1", 4, "Second."],
      ["p3", null, 2, "Third."],
    ]),
    { status: "partial", stopReason: "rate_limited", reported: 20, knownUnfetched: 5 },
  );
  const short = withReport(
    thread("short1", "Short thread", [
      ["s1", null, 3, "One."],
      ["s2", null, 1, "Two."],
    ]),
    { reported: 6 },
  );
  const noTotal = withReport(
    thread("nototal1", "Thread without a total", [
      ["n1", null, 3, "One."],
      ["n2", null, 1, "Two."],
    ]),
    { status: "limit_reached", stopReason: "comment_limit", reported: null, knownUnfetched: 4 },
  );
  const orphanBase = thread("orph1", "Thread with a missing parent", [
    ["o1", null, 5, "Top level."],
    ["o2", "gone1", 2, "Replying to something that wasn't fetched."],
  ]);
  const orphan = {
    ...orphanBase,
    records: orphanBase.records.map((record) => (record.comment_id === "o2" ? { ...record, parent_missing: true as const } : record)),
  };

  let folder: string;
  let reader: Client;
  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), "cs-mcp-partial-"));
    writeFileSync(join(folder, "partial.json"), toFlatJson([partial]));
    writeFileSync(join(folder, "short.json"), toFlatJson([short]));
    writeFileSync(join(folder, "no-total.json"), toFlatJson([noTotal]));
    writeFileSync(join(folder, "orphan.json"), toNestedJson([orphan]));
    reader = await clientFor(folder);
  });
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it("says how many comments a partial export is missing", async () => {
    const { text } = await call("read_thread", { thread: "reddit:part1" }, reader);
    expect(text).toContain(
      "Showing comments 1–3 of 3. That's the end of the export, not of the thread. Reddit reports 20 comments and this export has 3, so it's missing 17. Fetch status: partial (rate_limited).",
    );
  });

  it("flags an export with fewer comments than the source reports, even when nothing was left unfetched", async () => {
    const { text } = await call("read_thread", { thread: "reddit:short1" }, reader);
    expect(text).toContain("That's the end of the export, not of the thread. Reddit reports 6 comments and this export has 2, so it's missing 4.");
    expect(text).not.toContain("Fetch status");
  });

  it("falls back to the known-but-unfetched count when the source reports no total", async () => {
    const { text } = await call("read_thread", { thread: "reddit:nototal1" }, reader);
    expect(text).toContain(
      "That's the end of the export, not of the thread. Reddit doesn't report a total; this export has 2 comments, with at least 4 more known but not fetched. Fetch status: stopped at plan limit (comment_limit).",
    );
  });

  it("flags comments whose parent isn't in the export", async () => {
    const { text } = await call("read_thread", { thread: "reddit:orph1" }, reader);
    expect(text).toContain("[c2] reply to a comment not fetched");
    expect(text).toContain(
      "That's the end of the export, not of the thread. Reddit reports 2 comments; this export has 2 comments. 1 comment here replies to a comment that isn't in the export.",
    );
  });

  it("keeps the paging hint on earlier pages", async () => {
    const { text } = await call("read_thread", { thread: "reddit:part1", limit: 2 }, reader);
    expect(text).toContain("Showing comments 1–2 of 3. Call read_thread again with offset=2 for more.");
    expect(text).not.toContain("end of the export");
  });
});
