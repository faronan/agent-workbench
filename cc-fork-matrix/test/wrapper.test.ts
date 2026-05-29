import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wrapperPath = join(packageRoot, "bin", "cc-fork-matrix");

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runWrapper(
  args: string[],
  pathPrefix: string,
  env: NodeJS.ProcessEnv = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(wrapperPath, args, {
      env: {
        ...process.env,
        PATH: `${pathPrefix}${delimiter}${process.env.PATH ?? ""}`,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function withFakeGhq(
  body: string,
  fn: (args: { binDir: string; root: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "ccfm-wrapper-"));
  const binDir = join(root, "bin");
  try {
    await mkdir(binDir, { recursive: true });
    const ghqPath = join(binDir, "ghq");
    await writeFile(ghqPath, body);
    await chmod(ghqPath, 0o755);
    await fn({ binDir, root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("wrapper resolves the repository through ghq and runs the built CLI", async () => {
  await withFakeGhq(
    `#!/usr/bin/env sh
printf '%s\\n' "$CCFM_FAKE_REPO"
`,
    async ({ binDir, root }) => {
      const repo = join(root, "agent-workbench");
      const distDir = join(repo, "cc-fork-matrix", "dist");
      await mkdir(distDir, { recursive: true });
      await writeFile(
        join(distDir, "cli.js"),
        "process.stdout.write(JSON.stringify({ args: process.argv.slice(2) }));\n",
      );

      const result = await runWrapper(["--help", "--json"], binDir, { CCFM_FAKE_REPO: repo });

      assert.equal(result.code, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout).args, ["--help", "--json"]);
    },
  );
});

test("wrapper reports a missing ghq repository", async () => {
  await withFakeGhq(
    `#!/usr/bin/env sh
exit 0
`,
    async ({ binDir }) => {
      const result = await runWrapper(["--help"], binDir);

      assert.equal(result.code, 127);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /repository not found via ghq/);
    },
  );
});

test("wrapper tells the user to build when dist is missing", async () => {
  await withFakeGhq(
    `#!/usr/bin/env sh
printf '%s\\n' "$CCFM_FAKE_REPO"
`,
    async ({ binDir, root }) => {
      const repo = join(root, "agent-workbench");
      await mkdir(join(repo, "cc-fork-matrix"), { recursive: true });

      const result = await runWrapper(["--help"], binDir, { CCFM_FAKE_REPO: repo });

      assert.equal(result.code, 126);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /built CLI not found/);
      assert.match(result.stderr, /pnpm --dir .*cc-fork-matrix build/);
    },
  );
});
