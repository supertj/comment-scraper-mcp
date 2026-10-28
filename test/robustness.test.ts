import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SCHEMA_VERSION, toFlatJson, type ExportRecord, type FetchReport } from "../src/core/index.js";
import { Library } from "../src/library";
import { createServer } from "../src/server";

// Cross-review findings: bad files must not break the other exports, a parent loop must not
// hang, and no tool may return more than one response's worth of text.

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) {
    try {
      chmodSync(join(folder, "locked.json"), 0o644);
    } catch {}
    rmSync(folder, { recursive: true, force: true });
  }
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "cs-mcp-robust-"));
  folders.push(dir);
  return dir;
}

const base = { schema_version: SCHEMA_VERSION, source: "reddit" as const, subreddit: "test", score_hidden: false, edited_utc: null, is_op: false, comment_state: "normal" as const, created_utc: "2026-10-09T00:00:00.000Z" };

function bigThread(id: string, count: number, body: string) {
  const records: ExportRecord[] = [{ ...base, record_type: "post", thread_id: id, thread_title: `Thread ${id}`, comment_id: null, parent_id: null, depth: null, score: 1, body: "post", permalink: `https://www.reddit.com/r/test/comments/${id}/` } as ExportRecord];
  for (let index = 0; index < count; index++) {
    records.push({ ...base, record_type: "comment", thread_id: id, thread_title: `Thread ${id}`, comment_id: `${id}c${index}`, parent_id: id, depth: 0, score: index, body: `${body} ${index}`, permalink: `https://www.reddit.com/r/test/comments/${id}/_/${index}/` } as ExportRecord);
  }
  const report: FetchReport = { fetched: count, knownUnfetched: 0, reported: count, status: "all_known_fetched", stopReason: null, path: "json", requests: 1, fetchedAt: "2026-10-10T00:00:00.000Z" };
  return { records, report };
}

async function connect(dir: string) {
  const server = createServer(new Library([dir]));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return async (name: string, args: Record<string, unknown> = {}) =>
    ((await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> }).content[0]!.text;
}

describe("robustness", () => {
  it("skips unreadable and malformed files but keeps the good ones", async () => {
    const dir = folder();
    writeFileSync(join(dir, "good.json"), toFlatJson([bigThread("good", 2, "fine")]));
    writeFileSync(join(dir, "locked.json"), toFlatJson([bigThread("locked", 2, "x")]));
    chmodSync(join(dir, "locked.json"), 0o000);
    const marker = { schema_version: 1, exported_at: "x", generator: "Comment Scraper" };
    writeFileSync(join(dir, "nulls.json"), JSON.stringify({ ...marker, threads: [null, 7, "x"] }, null, 2));
    writeFileSync(join(dir, "no-meta.json"), JSON.stringify({ ...marker, threads: [{ records: [] }] }, null, 2));
    writeFileSync(join(dir, "bad-record.json"), JSON.stringify({ ...marker, threads: [{ meta: JSON.parse(toFlatJson([bigThread("bad", 1, "y")])).threads[0].meta, records: [null] }] }, null, 2));
    const call = await connect(dir);
    const list = await call("list_threads");
    expect(list).toContain("1 exported thread");
    expect(list).toContain("reddit:good");
  });

  it("stops at a parent loop instead of hanging", async () => {
    const dir = folder();
    const looped = bigThread("loop", 2, "z");
    looped.records[1] = { ...looped.records[1]!, parent_id: "loopc1" };
    looped.records[2] = { ...looped.records[2]!, parent_id: "loopc0" };
    writeFileSync(join(dir, "loop.json"), toFlatJson([looped]));
    const call = await connect(dir);
    const result = await call("get_comment", { thread: "reddit:loop", comment: "c1" });
    expect(result).toContain("## The comment");
  });

  it("keeps every tool's answer within one response", async () => {
    const dir = folder();
    const long = "renewal pricing went up again and everyone in the thread was annoyed about it ".repeat(6);
    writeFileSync(join(dir, "big.json"), toFlatJson([bigThread("big", 2_000, long)]));
    for (let index = 0; index < 400; index++) writeFileSync(join(dir, `t${index}.json`), toFlatJson([bigThread(`many${index}`, 1, "hi")]));
    const call = await connect(dir);
    const results = [
      await call("list_threads"),
      await call("read_thread", { thread: "reddit:big", limit: 500 }),
      await call("search_comments", { query: "renewal", limit: 100 }),
      await call("get_comment", { thread: "reddit:big", comment: "c1" }),
    ];
    // Claude Code saves a result over 50,000 characters to a file instead of showing it inline.
    for (const result of results) expect(result.length).toBeLessThan(50_000);
    expect(results[0]).toContain("more threads not shown");
    expect(results[1]).toContain("Call read_thread again with offset=");
    expect(results[2]).toContain("more matches not shown");
  });

  // The public GitHub copy doesn't ship the export script, so this check only runs here.
  it.skipIf(!existsSync(join(__dirname, "..", "export-public.mjs")))("refuses to export the public copy over a non-empty folder", () => {
    const dir = folder();
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "keep.txt"), "mine");
    expect(() => execFileSync("node", ["export-public.mjs", dir], { cwd: join(__dirname, ".."), stdio: "pipe" })).toThrow(/isn't empty/);
    expect(() => execFileSync("node", ["export-public.mjs", join(__dirname, "..", "tmp-out")], { cwd: join(__dirname, ".."), stdio: "pipe" })).toThrow(/outside the repository/);
  });
});

describe("second review", () => {
  it("keeps ambiguous-title errors and long posts within one response", async () => {
    const dir = folder();
    for (let index = 0; index < 400; index++) writeFileSync(join(dir, `t${index}.json`), toFlatJson([bigThread(`same${index}`, 1, "hi")]));
    const call = await connect(dir);
    const ambiguous = await call("read_thread", { thread: "Thread" });
    expect(ambiguous).toContain("matches 400 threads");
    expect(ambiguous).toContain("…and 380 more");
    expect(ambiguous.length).toBeLessThan(5_000);

    const huge = bigThread("hugepost", 1, "c");
    huge.records[0] = { ...huge.records[0]!, body: "x".repeat(200_000) };
    writeFileSync(join(dir, "huge.json"), toFlatJson([huge]));
    expect((await call("read_thread", { thread: "reddit:hugepost" })).length).toBeLessThan(62_000);
  });

  it("rejects nested exports whose comments or replies aren't arrays", async () => {
    const dir = folder();
    const good = bigThread("nested", 2, "old but intact");
    good.report.fetchedAt = "2026-10-01T00:00:00.000Z";
    writeFileSync(join(dir, "old.json"), toFlatJson([good]));
    const damaged = JSON.parse(toFlatJson([bigThread("nested", 2, "new")]));
    const meta = damaged.threads[0].meta;
    writeFileSync(join(dir, "damaged.json"), JSON.stringify({ schema_version: 1, exported_at: "x", generator: "Comment Scraper", threads: [{ meta, post: damaged.threads[0].records[0], comments: null }] }, null, 2));
    const call = await connect(dir);
    const read = await call("read_thread", { thread: "reddit:nested" });
    expect(read).toContain("old but intact");
  });

  it("doesn't call a reply to a missing comment top-level", async () => {
    const dir = folder();
    const orphan = bigThread("orphan", 1, "a reply");
    orphan.records[1] = { ...orphan.records[1]!, parent_id: "gone", depth: 1, parent_missing: true };
    writeFileSync(join(dir, "orphan.json"), toFlatJson([orphan]));
    const call = await connect(dir);
    expect(await call("get_comment", { thread: "reddit:orphan", comment: "c1" })).toContain("Replying to a comment that isn't in this export");
  });
});
