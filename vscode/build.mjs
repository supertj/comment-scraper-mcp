// Bundles the published comment-scraper-mcp server, with the MCP SDK and zod, into one file that
// the extension runs on VS Code's own Node. Taking the npm release rather than ../src means the
// extension ships exactly the server everyone else gets from npm, pinned in package.json.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { build } from "esbuild";

const { metafile } = await build({
  entryPoints: ["node_modules/comment-scraper-mcp/dist/index.js"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Some bundled dependencies are CommonJS and require() Node built-ins, which an ES module
  // can't do without this.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  legalComments: "none",
  metafile: true,
});

// Bundling copies third-party code into the .vsix, and their MIT/ISC licenses ask for the
// notice to travel with it.
const packages = new Set();
for (const input of Object.keys(metafile.inputs)) {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (match) packages.add(match[1]);
}
const notices = [...packages].sort().map((folder) => {
  const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
  const licenseFile = readdirSync(folder).find((name) => /^licen[cs]e/i.test(name));
  const text = licenseFile ? readFileSync(join(folder, licenseFile), "utf8").trim() : `License: ${manifest.license}`;
  return `${manifest.name} ${manifest.version}\n\n${text}`;
});
writeFileSync(
  join(dirname("dist/server.mjs"), "THIRD_PARTY_NOTICES.txt"),
  `This extension bundles the following packages.\n\n${notices.join(`\n\n${"-".repeat(72)}\n\n`)}\n`,
);
console.log(`Built dist/server.mjs with ${packages.size} packages`);
