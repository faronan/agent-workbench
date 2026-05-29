import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  defaultGlobalStateRoot,
  listRuns,
  resolveLastRunDir,
  writeLatestPointers,
} from "../src/run-discovery.ts";
import { runCommand } from "../src/shell.ts";
import type { RunMetadata, VariantResult } from "../src/types.ts";

async function tempRepo() {
  const root = await mkdtemp(join(tmpdir(), "ccfm-discovery-"));
  const repo = await createRepo(root, "repo");
  return { root, repo };
}

async function createRepo(root: string, name: string): Promise<string> {
  const repo = join(root, name);
  await mkdir(repo, { recursive: true });
  await runCommand("git", ["init"], repo);
  await writeFile(join(repo, "README.md"), "hello\n");
  await runCommand("git", ["add", "README.md"], repo);
  await runCommand(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "init"],
    repo,
  );
  return repo;
}

function variant(slug: string, status: VariantResult["status"]): VariantResult {
  return {
    name: slug,
    slug,
    status,
    branch: `branch/${slug}`,
    worktree: `/worktree/${slug}`,
    sessionIdAvailability: "unavailable",
    sessionIdUnavailableReason: "test",
    openCommand: {
      kind: "open-worktree",
      backend: "claude-cli",
      command: {
        cwd: `/worktree/${slug}`,
        argv: ["claude"],
        shellCommand: `cd /worktree/${slug} && claude`,
      },
      launchers: {
        ghostty: {
          cwd: `/worktree/${slug}`,
          argv: [
            "open",
            "-na",
            "Ghostty.app",
            "--args",
            `--working-directory=/worktree/${slug}`,
            "-e",
            "claude",
          ],
          shellCommand: `open -na Ghostty.app --args --working-directory=/worktree/${slug} -e claude`,
        },
      },
    },
    verification: [],
    verificationCommands: [],
    diffstat: "",
    changedFiles: [],
    artifactDir: `/artifact/${slug}`,
  };
}

async function writeRun(args: {
  repo: string;
  runDir: string;
  runId: string;
  name: string;
  updatedAt: string;
  statuses: VariantResult["status"][];
  launch?: RunMetadata["launch"];
}): Promise<RunMetadata> {
  const metadata: RunMetadata = {
    schemaVersion: 1,
    toolVersion: "0.1.0",
    runId: args.runId,
    name: args.name,
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: args.updatedAt,
    repoRoot: args.repo,
    baseRef: "HEAD",
    baseHead: "abc",
    source: { backend: "claude-cli", session: "source" },
    matrixHash: "hash",
    dirtyBase: false,
    dirtyBaseStatus: "",
    launch: args.launch,
    variants: args.statuses.map((status, index) => variant(`option-${index + 1}`, status)),
  };
  await mkdir(args.runDir, { recursive: true });
  await writeFile(join(args.runDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

test("listRuns returns latest runs with status counts and launch metadata", async () => {
  const repo = await tempRepo();
  try {
    const stateRoot = defaultGlobalStateRoot(repo.repo);
    await writeRun({
      repo: repo.repo,
      runDir: join(stateRoot, "demo", "runs", "old"),
      runId: "old",
      name: "demo",
      updatedAt: "2026-05-29T00:00:00.000Z",
      statuses: ["succeeded"],
    });
    await writeRun({
      repo: repo.repo,
      runDir: join(stateRoot, "demo", "runs", "new"),
      runId: "new",
      name: "demo",
      updatedAt: "2026-05-29T01:00:00.000Z",
      statuses: ["running", "verification_failed"],
      launch: {
        mode: "terminal",
        terminal: "zellij",
        layout: "tabs",
        launchedAt: "2026-05-29T00:59:00.000Z",
        launcherStrategy: "zellij-new-tab-argv",
        promptStoragePolicy: "not-persisted",
      },
    });

    const runs = await listRuns({ repo: repo.repo });

    assert.equal(runs[0].runId, "new");
    assert.equal(runs[0].runDir, await realpath(resolve(stateRoot, "demo", "runs", "new")));
    assert.equal(runs[0].backend, "claude-cli");
    assert.equal(runs[0].terminal, "zellij");
    assert.equal(runs[0].statusCounts.running, 1);
    assert.equal(runs[0].statusCounts.verification_failed, 1);
    assert.equal(runs[1].runId, "old");
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("resolveLastRunDir uses latest pointer then falls back to valid metadata scan", async () => {
  const repo = await tempRepo();
  try {
    const stateRoot = defaultGlobalStateRoot(repo.repo);
    const latestRunDir = join(stateRoot, "demo", "runs", "latest");
    const metadata = await writeRun({
      repo: repo.repo,
      runDir: latestRunDir,
      runId: "latest",
      name: "demo",
      updatedAt: "2026-05-29T01:00:00.000Z",
      statuses: ["running"],
    });
    await writeLatestPointers({
      repoRoot: repo.repo,
      stateRoot,
      runDir: latestRunDir,
      metadata,
    });

    assert.equal(await resolveLastRunDir({ repo: repo.repo }), await realpath(latestRunDir));

    await writeFile(
      join(stateRoot, "latest.json"),
      `${JSON.stringify({ schemaVersion: 1, runDir: join(repo.root, "missing") }, null, 2)}\n`,
    );

    assert.equal(await resolveLastRunDir({ repo: repo.repo }), await realpath(latestRunDir));
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("listRuns includes latest pointer runs outside the default state root", async () => {
  const repo = await tempRepo();
  try {
    const customStateRoot = join(repo.root, "custom-state");
    const runDir = join(customStateRoot, "runs", "custom");
    const metadata = await writeRun({
      repo: repo.repo,
      runDir,
      runId: "custom",
      name: "custom-demo",
      updatedAt: "2026-05-29T02:00:00.000Z",
      statuses: ["running"],
    });
    await writeLatestPointers({
      repoRoot: repo.repo,
      stateRoot: customStateRoot,
      runDir,
      metadata,
    });

    const runs = await listRuns({ repo: repo.repo });

    assert.equal(runs[0].runId, "custom");
    assert.equal(runs[0].runDir, await realpath(runDir));
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("listRuns and --last ignore sibling repository runs in a shared state root", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccfm-discovery-siblings-"));
  try {
    const repoA = await createRepo(root, "repo-a");
    const repoB = await createRepo(root, "repo-b");
    const stateRoot = defaultGlobalStateRoot(repoA);
    const repoARunDir = join(stateRoot, "demo", "runs", "repo-a-old");
    const repoBRunDir = join(stateRoot, "demo", "runs", "repo-b-new");

    await writeRun({
      repo: repoA,
      runDir: repoARunDir,
      runId: "repo-a-old",
      name: "demo",
      updatedAt: "2026-05-29T00:00:00.000Z",
      statuses: ["succeeded"],
    });
    const repoBMetadata = await writeRun({
      repo: repoB,
      runDir: repoBRunDir,
      runId: "repo-b-new",
      name: "demo",
      updatedAt: "2026-05-29T01:00:00.000Z",
      statuses: ["running"],
    });
    await writeLatestPointers({
      repoRoot: repoB,
      stateRoot,
      runDir: repoBRunDir,
      metadata: repoBMetadata,
    });

    const runs = await listRuns({ repo: repoA });

    assert.deepEqual(
      runs.map((run) => run.runId),
      ["repo-a-old"],
    );
    assert.equal(await resolveLastRunDir({ repo: repoA }), await realpath(repoARunDir));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
