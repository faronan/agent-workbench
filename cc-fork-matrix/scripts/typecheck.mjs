import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const roots = ["src"];
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
}

for (const root of roots) {
  walk(root);
}

for (const file of files.filter((file) => !file.endsWith("src/cli.ts"))) {
  await import(pathToFileURL(file).href);
}

const result = spawnSync(process.execPath, ["--experimental-strip-types", "src/cli.ts", "--help"], {
  encoding: "utf8",
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.stderr.write(result.stdout);
  process.exit(result.status ?? 1);
}

console.log(`Loaded ${files.length} TypeScript source files with Node type stripping.`);
