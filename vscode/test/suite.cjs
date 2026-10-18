const assert = require("node:assert/strict");
const vscode = require("vscode");

// Runs inside VS Code, started by run.mjs. It goes the way a user would: listing MCP servers
// activates the extension, the server starts on VS Code's own Node, and a tool call answers
// from the folder set in the settings. The workbench.mcp.* commands are VS Code internals, so
// if a VS Code update renames them this test fails before users notice anything else.

const TOOLS = ["get_comment", "list_threads", "read_thread", "search_comments"];

exports.run = async () => {
  const extension = vscode.extensions.all.find((candidate) => candidate.packageJSON.name === "comment-scraper-mcp");
  assert.ok(extension, "the extension is not loaded");
  assert.equal(extension.isActive, false, "the extension should wait until VS Code asks for MCP servers");

  // MCP: List Servers makes VS Code activate every extension that provides servers.
  void vscode.commands.executeCommand("workbench.mcp.listServer");
  await within(15_000, "activation", until(() => extension.isActive));
  await vscode.commands.executeCommand("workbench.action.closeQuickOpen");

  const serverId = `${extension.id.toLowerCase()}/Comment Scraper`;
  await within(30_000, "server start", vscode.commands.executeCommand("workbench.mcp.startServer", serverId, { waitForLiveTools: true }));

  // VS Code prefixes MCP tool names with a shortened server name; match on the server's own names.
  const tools = vscode.lm.tools.filter((tool) => TOOLS.some((name) => tool.name.endsWith(`_${name}`)));
  assert.deepEqual(tools.map((tool) => TOOLS.find((name) => tool.name.endsWith(`_${name}`))).sort(), TOOLS);

  const listThreads = tools.find((tool) => tool.name.endsWith("_list_threads"));
  const [folder] = vscode.workspace.getConfiguration().get("commentScraper.exportFolders");
  await expectFolder(listThreads, folder);

  // Changing the setting has to reach the server without restarting VS Code. VS Code swaps the
  // server a moment after the change (about two seconds here), so keep asking for a while.
  const otherFolder = `${folder} 2`;
  await vscode.workspace.getConfiguration().update("commentScraper.exportFolders", [otherFolder], vscode.ConfigurationTarget.Global);
  for (let attempt = 1; ; attempt++) {
    try {
      await expectFolder(listThreads, otherFolder);
      break;
    } catch (error) {
      if (attempt === 15) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  console.log(`VS Code ${vscode.version}: server started with ${tools.length} tools and followed the folder setting`);
};

/** list_threads names the folders it read when it finds no exports there. */
async function expectFolder(listThreads, folder) {
  const result = await within(15_000, "list_threads", vscode.lm.invokeTool(listThreads.name, { input: {}, toolInvocationToken: undefined }));
  const text = result.content.map((part) => part.value).join("\n");
  assert.ok(text.includes(`No Comment Scraper exports found in: ${folder}.`), `list_threads should read ${folder}, got: ${text}`);
}

async function until(condition) {
  while (!condition()) await new Promise((resolve) => setTimeout(resolve, 200));
}

function within(ms, what, promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
