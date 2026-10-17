import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: plain JavaScript that Pi loads as is, so it has no type declarations.
import commentScraper from "../pi/extension.js";

// The Pi package is only a manifest and a tiny extension; what breaks it is a path that moved
// or a file that npm leaves out of the tarball, so that's what these tests pin down.

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("Pi package", () => {
  it("registers the bundled server with Pi's MCP support", () => {
    const registered: Array<[string, Record<string, unknown>]> = [];
    commentScraper({ registerMcpServer: (name: string, config: Record<string, unknown>) => registered.push([name, config]) });

    expect(registered).toHaveLength(1);
    const [name, config] = registered[0]!;
    expect(name).toBe("comment-scraper");
    expect(config.command).toBe(process.execPath);
    // The same file npm installs as the comment-scraper-mcp command.
    expect(config.args).toEqual([join(root, manifest.bin["comment-scraper-mcp"])]);
    expect(config.exposure).toBe("direct");
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
