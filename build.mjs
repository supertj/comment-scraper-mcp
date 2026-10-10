// Bundles the server and @cs/core into one file for npm; the MCP SDK and zod stay as dependencies.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["@modelcontextprotocol/sdk", "zod"],
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
});
console.log("Built dist/index.js");
