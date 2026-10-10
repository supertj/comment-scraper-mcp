import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Library } from "./library.js";
import { createServer, VERSION } from "./server.js";

// comment-scraper-mcp [--dir <folder>]...
// Folders come from --dir (repeatable), else COMMENT_SCRAPER_DIRS (separated like PATH),
// else the Downloads folder, which is where the extension's exports land.

const HELP = `comment-scraper-mcp ${VERSION}
Lets Claude and other MCP clients read your Comment Scraper exports. Local and read-only.

Usage: comment-scraper-mcp [--dir <folder>]...

  --dir <folder>   Folder with your JSON exports (repeatable). Default: your Downloads folder.
                   Subfolders one level down are included.
  --help           Show this message.
  --version        Print the version.

Environment: COMMENT_SCRAPER_DIRS works like --dir, folders separated by ":" (";" on Windows).`;

function folders(argv: string[]): string[] {
  const fromArgs: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--dir" && argv[index + 1]) fromArgs.push(argv[++index]!);
    else if (argv[index]?.startsWith("--dir=")) fromArgs.push(argv[index]!.slice("--dir=".length));
  }
  const fromEnv = (process.env.COMMENT_SCRAPER_DIRS ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean);
  const chosen = fromArgs.length ? fromArgs : fromEnv.length ? fromEnv : [join(homedir(), "Downloads")];
  return chosen.map((folder) => resolve(folder.replace(/^~(?=$|[\\/])/, homedir())));
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
} else if (argv.includes("--version")) {
  console.log(VERSION);
} else {
  // stdout is the MCP channel; anything for a human goes to stderr.
  const library = new Library(folders(argv));
  console.error(`comment-scraper-mcp ${VERSION}: reading exports from ${library.folders.join(", ")}`);
  await createServer(library).connect(new StdioServerTransport());
}
