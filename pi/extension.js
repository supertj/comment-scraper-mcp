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
    // Pi always runs on Node, and this is the Node running it, so PATH doesn't matter.
    command: process.execPath,
    args: [serverPath],
    // Four small read-only tools: declaring them directly costs little and saves the model a
    // tool search before every question about an export.
    exposure: "direct",
    description: "Reads the Reddit and Hacker News threads the user exported with Comment Scraper.",
  });
}
