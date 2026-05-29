import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finalizeRun } from "../src/finalize.ts";
import { runCommand } from "../src/shell.ts";
import type { RunMetadata, VariantResult, VerificationCommand } from "../src/types.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function tempRepo() {
  const root = await mkdtemp(join(tmpdir(), "ccfm-finalize-"));
  const repo = join(root, "repo");
  const runDir = join(root, ".cc-fork-matrix", "demo", "runs", "run");
  const worktree = join(root, "worktrees", "option-a");
  await mkdir(repo, { recursive: true });
  await mkdir(runDir, { recursive: true });
  await runCommand("git", ["init"], repo);
  await runCommand("git", ["config", "user.email", "test@example.com"], repo);
  await runCommand("git", ["config", "user.name", "Test"], repo);
  await writeFile(join(repo, "README.md"), "hello\n");
  await runCommand("git", ["add", "README.md"], repo);
  await runCommand("git", ["commit", "-m", "init"], repo);
  await runCommand("git", ["worktree", "add", "-b", "finalize/option-a", worktree, "HEAD"], repo);
  return { root, repo, runDir, worktree };
}

function runningVariant(args: {
  runDir: string;
  worktree: string;
  verificationCommands?: VerificationCommand[];
}): VariantResult {
  const artifactDir = join(args.runDir, "option-a");
  return {
    name: "Option A",
    slug: "option-a",
    status: "running",
    branch: "finalize/option-a",
    worktree: args.worktree,
    sessionIdAvailability: "unavailable",
    sessionIdUnavailableReason: "test",
    openCommand: {
      kind: "open-worktree",
      backend: "claude-cli",
      sessionIdAvailability: "unavailable",
      sessionIdUnavailableReason: "test",
      command: {
        cwd: args.worktree,
        argv: ["claude"],
        shellCommand: `cd ${args.worktree} && claude`,
      },
      launchers: {
        ghostty: {
          cwd: args.worktree,
          argv: [
            "open",
            "-na",
            "Ghostty.app",
            "--args",
            `--working-directory=${args.worktree}`,
            "-e",
            "claude",
          ],
          shellCommand: `open -na Ghostty.app --args --working-directory=${args.worktree} -e claude`,
        },
      },
    },
    verification: [],
    verificationCommands: args.verificationCommands ?? [],
    diffstat: "",
    changedFiles: [],
    artifactDir,
  };
}

async function writeRunMetadata(args: {
  runDir: string;
  repo: string;
  worktree: string;
  verificationCommands?: VerificationCommand[];
}): Promise<void> {
  const metadata: RunMetadata = {
    schemaVersion: 1,
    toolVersion: "0.1.0",
    runId: "run",
    name: "demo",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    repoRoot: args.repo,
    baseRef: "HEAD",
    baseHead: "abc",
    source: { backend: "claude-cli", session: "source" },
    matrixHash: "hash",
    dirtyBase: false,
    dirtyBaseStatus: "",
    launch: {
      mode: "terminal",
      terminal: "ghostty",
      layout: "tabs",
      launchedAt: "2026-05-29T00:00:01.000Z",
      launcherStrategy: "ghostty-command-env",
      promptStoragePolicy: "not-persisted",
    },
    variants: [
      runningVariant({
        runDir: args.runDir,
        worktree: args.worktree,
        verificationCommands: args.verificationCommands,
      }),
    ],
  };
  await mkdir(join(args.runDir, "option-a"), { recursive: true });
  await writeFile(join(args.runDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

test("finalize marks changed running variants as succeeded when no verification exists", async () => {
  const repo = await tempRepo();
  try {
    await writeRunMetadata(repo);
    await writeFile(join(repo.worktree, "changed.txt"), "changed\n");

    const result = await finalizeRun(repo.runDir);

    assert.equal(result.variants[0].previousStatus, "running");
    assert.equal(result.variants[0].status, "succeeded");
    assert.deepEqual(result.variants[0].changedFiles, ["changed.txt"]);

    const metadata = JSON.parse(await readFile(join(repo.runDir, "metadata.json"), "utf8"));
    assert.equal(metadata.variants[0].status, "succeeded");
    assert.equal(typeof metadata.variants[0].finalizedAt, "string");
    assert.deepEqual(metadata.variants[0].changedFiles, ["changed.txt"]);
    assert.match(await readFile(join(repo.runDir, "report.md"), "utf8"), /succeeded/);
    assert.equal(await exists(join(repo.runDir, "option-a", "diff.patch")), true);
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("finalize marks unchanged running variants as skipped", async () => {
  const repo = await tempRepo();
  try {
    await writeRunMetadata(repo);

    const result = await finalizeRun(repo.runDir);

    assert.equal(result.variants[0].status, "skipped");
    assert.deepEqual(result.variants[0].changedFiles, []);
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("finalize runs verification commands and records failures", async () => {
  const repo = await tempRepo();
  try {
    await writeRunMetadata({
      ...repo,
      verificationCommands: [{ name: "missing", command: "test -f missing.txt" }],
    });
    await writeFile(join(repo.worktree, "changed.txt"), "changed\n");

    const result = await finalizeRun(repo.runDir);

    assert.equal(result.variants[0].status, "verification_failed");
    assert.equal(result.variants[0].verification[0].name, "missing");
    assert.notEqual(result.variants[0].verification[0].code, 0);
    assert.match(
      await readFile(join(repo.runDir, "option-a", "verification.log"), "utf8"),
      /\$ test -f missing\.txt/,
    );
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("finalize skips running variants with missing worktrees", async () => {
  const repo = await tempRepo();
  try {
    await writeRunMetadata({ ...repo, worktree: join(repo.root, "missing-worktree") });

    const result = await finalizeRun(repo.runDir);

    assert.equal(result.variants[0].status, "skipped");
    assert.match(result.variants[0].error ?? "", /missing worktree/i);
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});
