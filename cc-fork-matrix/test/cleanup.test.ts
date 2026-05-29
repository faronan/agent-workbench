import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cleanupRun, renderCleanupResult } from "../src/cleanup.ts";
import { runCommand } from "../src/shell.ts";
import type { RunMetadata, VariantResult } from "../src/types.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function tempRepo() {
  const root = await mkdtemp(join(tmpdir(), "ccfm-cleanup-"));
  const repo = join(root, "repo");
  const runDir = join(root, "run");
  const worktreeA = join(root, "worktrees", "option-a");
  const worktreeB = join(root, "worktrees", "option-b");
  await mkdir(repo, { recursive: true });
  await mkdir(runDir, { recursive: true });
  await runCommand("git", ["init"], repo);
  await runCommand("git", ["config", "user.email", "test@example.com"], repo);
  await runCommand("git", ["config", "user.name", "Test"], repo);
  await writeFile(join(repo, "README.md"), "hello\n");
  await runCommand("git", ["add", "README.md"], repo);
  await runCommand("git", ["commit", "-m", "init"], repo);
  await runCommand("git", ["worktree", "add", "-b", "cleanup/option-a", worktreeA, "HEAD"], repo);
  await runCommand("git", ["worktree", "add", "-b", "cleanup/option-b", worktreeB, "HEAD"], repo);
  await writeMetadata(runDir, repo, worktreeA, worktreeB);
  return { root, repo, runDir, worktreeA, worktreeB };
}

function variant(name: string, slug: string, branch: string, worktree: string): VariantResult {
  return {
    name,
    slug,
    status: "running",
    branch,
    worktree,
    sessionIdAvailability: "unavailable",
    sessionIdUnavailableReason: "test",
    openCommand: {
      kind: "open-worktree",
      backend: "claude-cli",
      command: {
        cwd: worktree,
        argv: ["claude"],
        shellCommand: `cd ${worktree} && claude`,
      },
      launchers: {
        ghostty: {
          cwd: worktree,
          argv: [
            "open",
            "-na",
            "Ghostty.app",
            "--args",
            `--working-directory=${worktree}`,
            "-e",
            "claude",
          ],
          shellCommand: `open -na Ghostty.app --args --working-directory=${worktree} -e claude`,
        },
      },
    },
    verification: [],
    diffstat: "",
    changedFiles: [],
    artifactDir: join(worktree, ".artifact"),
  };
}

async function writeMetadata(
  runDir: string,
  repo: string,
  worktreeA: string,
  worktreeB: string,
): Promise<void> {
  const metadata: RunMetadata = {
    schemaVersion: 1,
    toolVersion: "0.1.0",
    runId: "cleanup-run",
    name: "cleanup-run",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    repoRoot: repo,
    baseRef: "HEAD",
    baseHead: "abc",
    source: { backend: "claude-cli", session: "source" },
    matrixHash: "hash",
    dirtyBase: false,
    dirtyBaseStatus: "",
    variants: [
      variant("Option A", "option-a", "cleanup/option-a", worktreeA),
      variant("Option B", "option-b", "cleanup/option-b", worktreeB),
    ],
  };
  await writeFile(join(runDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

test("cleanup dry-run lists clean worktrees without removing them", async () => {
  const repo = await tempRepo();
  try {
    const result = await cleanupRun(repo.runDir, { dryRun: true });
    const output = renderCleanupResult(result);

    assert.equal(result.dryRun, true);
    assert.deepEqual(
      result.variants.map((entry) => entry.status),
      ["would-remove", "would-remove"],
    );
    assert.equal(await exists(repo.worktreeA), true);
    assert.equal(await exists(repo.worktreeB), true);
    assert.match(output, /Mode: dry-run/);
    assert.match(output, /status: would-remove/);
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("cleanup removes clean worktrees from metadata", async () => {
  const repo = await tempRepo();
  try {
    const result = await cleanupRun(repo.runDir);

    assert.equal(result.dryRun, false);
    assert.deepEqual(
      result.variants.map((entry) => entry.status),
      ["removed", "removed"],
    );
    assert.equal(await exists(repo.worktreeA), false);
    assert.equal(await exists(repo.worktreeB), false);
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("cleanup refuses dirty worktrees unless forced", async () => {
  const repo = await tempRepo();
  try {
    await writeFile(join(repo.worktreeA, "dirty.txt"), "dirty\n");

    await assert.rejects(() => cleanupRun(repo.runDir), /Refusing to remove dirty worktrees/);
    assert.equal(await exists(repo.worktreeA), true);
    assert.equal(await exists(repo.worktreeB), true);

    const forced = await cleanupRun(repo.runDir, { force: true });
    assert.deepEqual(
      forced.variants.map((entry) => entry.status),
      ["removed", "removed"],
    );
    assert.equal(await exists(repo.worktreeA), false);
    assert.equal(await exists(repo.worktreeB), false);
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});
