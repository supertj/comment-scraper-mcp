const vscode = require("vscode");

// Hands the comment-scraper-mcp server to VS Code's MCP support, so chat gets the same four
// read-only tools as every other client. The server is bundled in this extension
// (dist/server.mjs, built from the npm release) instead of started with npx: users don't need
// Node.js installed, nothing is downloaded when it starts, and it works offline.

const PROVIDER_ID = "commentScraper";
const FOLDERS_SETTING = "commentScraper.exportFolders";

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const definitionsChanged = new vscode.EventEmitter();
  context.subscriptions.push(
    definitionsChanged,
    // VS Code stops a running server when its definition changes and starts it again with the
    // new folders the next time a tool is called.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(FOLDERS_SETTING)) definitionsChanged.fire();
    }),
    vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: definitionsChanged.event,
      provideMcpServerDefinitions: () => [serverDefinition(context)],
    }),
  );
}

/** @param {vscode.ExtensionContext} context */
function serverDefinition(context) {
  const folders = vscode.workspace.getConfiguration().get(FOLDERS_SETTING, []);
  // --dir=<folder> keeps each folder in one argument, so a path that starts with "-" can't be
  // read as a flag. The server expands a leading ~ itself.
  const dirArgs = (Array.isArray(folders) ? folders : [])
    .filter((folder) => typeof folder === "string" && folder.trim())
    .map((folder) => `--dir=${folder.trim()}`);
  return new vscode.McpStdioServerDefinition(
    "Comment Scraper",
    // The Node inside VS Code, as the API docs suggest for Node servers. In the desktop app
    // process.execPath is an Electron helper, which only behaves as plain Node with
    // ELECTRON_RUN_AS_NODE set; in a remote extension host it is node already and the variable
    // does nothing.
    process.execPath,
    [context.asAbsolutePath("dist/server.mjs"), ...dirArgs],
    // The server also reads COMMENT_SCRAPER_DIRS, and VS Code passes the shell environment on.
    // Someone who set it for Pi or Claude Code would otherwise get those folders here even with
    // the setting empty, so the setting stays the only place that decides what VS Code reads.
    { ELECTRON_RUN_AS_NODE: "1", COMMENT_SCRAPER_DIRS: null },
    // Cached tool lists are tied to this; it changes only when a new build of the extension
    // (and so of the bundled server) is installed.
    context.extension.packageJSON.version,
  );
}

module.exports = { activate };
