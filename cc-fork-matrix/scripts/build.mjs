import { spawnSync } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(packageRoot, "dist", "cli.js");

await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [join(packageRoot, "src", "cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: {
    js: "#!/usr/bin/env node",
  },
  legalComments: "none",
  logLevel: "silent",
});

await chmod(outfile, 0o755);

const smoke = spawnSync(process.execPath, [outfile, "--help"], {
  cwd: packageRoot,
  encoding: "utf8",
});

if (smoke.status !== 0) {
  process.stderr.write(smoke.stderr);
  process.stderr.write(smoke.stdout);
  process.exit(smoke.status ?? 1);
}

const typecheck = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "scripts/typecheck.mjs"],
  {
    cwd: packageRoot,
    encoding: "utf8",
  },
);

if (typecheck.status !== 0) {
  process.stderr.write(typecheck.stderr);
  process.stderr.write(typecheck.stdout);
  process.exit(typecheck.status ?? 1);
}

process.stdout.write(`Built ${outfile}\n`);
