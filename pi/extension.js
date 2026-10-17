import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

// Pi extension: hands this package's own MCP server to Pi's built-in MCP support, so Pi gets the
// same four tools as every other client without a second implementation to keep in sync.

// The server ships in this package, so Pi starts it from the installed copy. npx would fetch the
// package again and fail offline.
const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/** @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi */
export default function commentScraper(pi) {
  // MCP support arrived in Pi 0.99; on older versions say what to do instead of a bare TypeError.
  if (typeof pi.registerMcpServer !== "function") {
    throw new Error("comment-scraper-mcp needs Pi 0.99 or newer for MCP support. Run `pi update`.");
  }
  pi.registerMcpServer("comment-scraper", {
    // Pi installed from npm runs on Node, so its own executable is a Node that is known to work,
    // even when no node is on PATH. Pi's release binaries are compiled with Bun instead, and there
    // execPath is Pi itself: launching it with the server file starts another Pi, which loads this
    // extension again.
    command: process.versions.bun ? nodeOnPath() : process.execPath,
    args: [serverPath],
    // Four small read-only tools: declaring them directly costs little and saves the model a
    // tool search before every question about an export.
    exposure: "direct",
    description: "Reads the Reddit and Hacker News threads the user exported with Comment Scraper.",
  });
}

// An absolute path, not a bare "node": on Windows a bare name is looked up in the working
// directory before PATH, and Pi starts the server in whatever project it was opened in, so a
// node.exe or node.cmd committed to that project would run. Relative PATH entries are skipped
// for the same reason.
function nodeOnPath() {
  const name = process.platform === "win32" ? "node.exe" : "node";
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(folder)) continue;
    const candidate = join(folder, name);
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {}
  }
  throw new Error("comment-scraper-mcp needs Node.js 20 or newer on PATH when Pi runs as a standalone binary.");
}
