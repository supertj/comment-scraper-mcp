import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// @ts-expect-error: plain JavaScript that Pi loads as is, so it has no type declarations.
import commentScraper from "../pi/extension.js";

// The Pi package is only a manifest and a tiny extension; what breaks it is a path that moved,
// a file that npm leaves out of the tarball, or a command that doesn't start the server.

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function register() {
  const registered: Array<[string, { command: string; args: string[]; exposure: string }]> = [];
  commentScraper({ registerMcpServer: (name: string, config: (typeof registered)[number][1]) => registered.push([name, config]) });
  expect(registered).toHaveLength(1);
  return registered[0]!;
}

describe("Pi package", () => {
  it("registers the bundled server with Pi's MCP support", () => {
    const [name, config] = register();
    expect(name).toBe("comment-scraper");
    expect(config.command).toBe(process.execPath);
    // The same file npm installs as the comment-scraper-mcp command.
    expect(config.args).toEqual([join(root, manifest.bin["comment-scraper-mcp"])]);
    expect(config.exposure).toBe("direct");
  });

  it("uses node from PATH when Pi is a Bun-compiled binary", () => {
    // There process.execPath is the pi binary, and starting it with the server file starts another Pi.
    const versions = process.versions as Record<string, string | undefined>;
    versions.bun = "1.3.0";
    try {
      expect(register()[1].command).toBe("node");
    } finally {
      delete versions.bun;
    }
  });

  it("starts the server with the registered command", async () => {
    execFileSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "pipe" });
    const [, config] = register();
    const client = new Client({ name: "pi-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: config.command, args: config.args, stderr: "pipe" }));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(["get_comment", "list_threads", "read_thread", "search_comments"]);
    } finally {
      await client.close();
    }
  });

  it("says which Pi version it needs when MCP support is missing", () => {
    expect(() => commentScraper({})).toThrow("Pi 0.99 or newer");
  });

  it("declares the pi-package keyword and only paths that exist and ship to npm", () => {
    expect(manifest.keywords).toContain("pi-package");
    const paths: string[] = [...manifest.pi.extensions, ...manifest.pi.skills];
    for (const path of paths) {
      expect(existsSync(join(root, path)), path).toBe(true);
      const relative = path.replace(/^\.\//, "");
      expect(
        manifest.files.some((entry: string) => relative === entry || relative.startsWith(`${entry}/`)),
        `${path} is not in "files"`,
      ).toBe(true);
    }
    expect(existsSync(join(root, "plugin/skills/exported-threads/SKILL.md"))).toBe(true);
  });
});
