import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { RunMetadata } from "../src/types.ts";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageRoot, "src", "cli.ts");
const INVALID_METADATA_MESSAGE = "legacy/invalid metadata; rerun cc-fork-matrix";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function validMetadata(): RunMetadata {
  return {
    schemaVersion: 1,
    toolVersion: "0.1.0",
    runId: "run",
    name: "demo",
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    repoRoot: "/repo",
    baseRef: "HEAD",
    baseHead: "abc",
    source: { backend: "claude-cli", session: "source" },
    matrixHash: "hash",
    dirtyBase: false,
    dirtyBaseStatus: "",
    variants: [
      {
        name: "A",
        slug: "a",
        status: "succeeded",
        branch: "branch-a",
        worktree: "/worktree/a",
        sessionId: "sid-a",
        openCommand: {
          kind: "resume-session",
          backend: "claude-cli",
          sessionId: "sid-a",
          sessionIdAvailability: "captured",
          command: {
            cwd: "/worktree/a",
            argv: ["claude", "--resume", "sid-a"],
            shellCommand: "cd /worktree/a && claude --resume sid-a",
          },
          launchers: {
            ghostty: {
              cwd: "/worktree/a",
              argv: [
                "open",
                "-na",
                "Ghostty.app",
                "--args",
                "--working-directory=/worktree/a",
                "-e",
                "claude",
                "--resume",
                "sid-a",
              ],
              shellCommand:
                "open -na Ghostty.app --args --working-directory=/worktree/a -e claude --resume sid-a",
            },
          },
        },
        verification: [],
        diffstat: "",
        changedFiles: [],
        artifactDir: "/artifact/a",
      },
    ],
  };
}

function legacyResumeCommandMetadata(): unknown {
  const metadata = structuredClone(validMetadata()) as unknown as Record<string, unknown>;
  const variants = metadata.variants as Array<Record<string, unknown>>;
  delete variants[0].openCommand;
  variants[0].resumeCommand = "cd /worktree/a && claude --resume sid-a";
  return metadata;
}

async function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", cliPath, ...args], {
      cwd: packageRoot,
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

async function withRunDir(
  metadata: unknown,
  fn: (args: { runDir: string }) => Promise<void>,
): Promise<void> {
  const runDir = await mkdtemp(join(tmpdir(), "ccfm-cli-"));
  try {
    await writeFile(join(runDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    await fn({ runDir });
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

for (const command of ["open", "status", "report"] as const) {
  test(`${command} reports legacy metadata as a user-facing CLI error`, async () => {
    await withRunDir(legacyResumeCommandMetadata(), async ({ runDir }) => {
      const result = await runCli([command, runDir]);

      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(INVALID_METADATA_MESSAGE));
      assert.doesNotMatch(result.stderr, /TypeError/);
      assert.doesNotMatch(result.stderr, /Cannot read properties/);
      assert.doesNotMatch(result.stderr, /\n\s+at /);
    });
  });
}

test("status prints valid metadata through the CLI", async () => {
  await withRunDir(validMetadata(), async ({ runDir }) => {
    const result = await runCli(["status", runDir]);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const metadata = JSON.parse(result.stdout) as RunMetadata;
    assert.equal(metadata.variants[0].openCommand.kind, "resume-session");
  });
});
