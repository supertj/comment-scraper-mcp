// Starts an installed VS Code with this extension and runs suite.cjs inside it, with a throwaway
// profile so your own settings and extensions are left alone. A VS Code window opens briefly.
// On Windows or Linux, or with VS Code somewhere other than /Applications, set VSCODE_EXECUTABLE
// to the VS Code binary itself (Code.exe on Windows, code on Linux), not the `code` shell command.
// `npm test -- <file.vsix>` runs the same checks on a packaged extension instead of this folder,
// which catches a file the .vsix leaves out (needs unzip).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const executable = process.env.VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
if (!existsSync(executable)) {
  console.error(`VS Code not found at ${executable}. Set VSCODE_EXECUTABLE to its binary.`);
  process.exit(1);
}

const sourceRoot = resolve(import.meta.dirname, "..");
// Kept short: VS Code puts its IPC socket in the profile folder, and macOS limits socket paths
// to about 100 characters.
const scratch = mkdtempSync(join(tmpdir(), "cs-vsc-"));
const profile = join(scratch, "profile");
// A space in the path checks that the folder reaches the server as one argument.
const exportsFolder = join(scratch, "my exports");
mkdirSync(join(profile, "User"), { recursive: true });
mkdirSync(exportsFolder);
writeFileSync(join(profile, "User", "settings.json"), JSON.stringify({ "commentScraper.exportFolders": [exportsFolder] }));

let extensionRoot = sourceRoot;
const vsix = process.argv[2];
if (vsix) {
  const unzip = spawnSync("unzip", ["-q", resolve(vsix), "extension/*", "-d", join(scratch, "vsix")], { stdio: "inherit" });
  if (unzip.status !== 0) throw unzip.error ?? new Error(`Couldn't unpack ${vsix}`);
  extensionRoot = join(scratch, "vsix", "extension");
}

const run = spawnSync(
  executable,
  [
    `--user-data-dir=${profile}`,
    `--extensions-dir=${join(scratch, "extensions")}`,
    "--disable-telemetry",
    "--skip-welcome",
    "--skip-release-notes",
    `--extensionDevelopmentPath=${extensionRoot}`,
    `--extensionTestsPath=${join(sourceRoot, "test", "suite.cjs")}`,
  ],
  { stdio: "inherit" },
);
rmSync(scratch, { recursive: true, force: true });
if (run.error) throw run.error;
process.exit(run.status ?? 1);
