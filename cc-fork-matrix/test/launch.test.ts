import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildClaudeLaunchTarget,
  buildCodexLaunchTarget,
  launchDryRunJson,
  renderLaunchDryRun,
} from "../src/launch.ts";
import { parseMatrixText } from "../src/matrix.ts";
import { resolveRun } from "../src/resolve.ts";
import {
  CLAUDE_LAUNCH_SESSION_UNAVAILABLE_REASON,
  CODEX_LAUNCH_SESSION_UNAVAILABLE_REASON,
  launchMatrix,
} from "../src/runner.ts";
import { runCommand } from "../src/shell.ts";
import type { AgentLaunchTarget } from "../src/types.ts";

async function tempRepo() {
  const dir = await mkdtemp(join(tmpdir(), "ccfm-launch-"));
  await runCommand("git", ["init"], dir);
  await runCommand("git", ["config", "user.email", "test@example.com"], dir);
  await runCommand("git", ["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "README.md"), "hello\n");
  await runCommand("git", ["add", "README.md"], dir);
  await runCommand("git", ["commit", "-m", "init"], dir);
  return dir;
}

async function fakeCodex(repo: string): Promise<string> {
  const command = join(repo, "fake-codex-launch.sh");
  await writeFile(
    command,
    `#!/bin/sh
if [ "$1" = "fork" ] && [ "$2" = "--help" ]; then
  printf 'Usage: codex fork [OPTIONS] [SESSION_ID] [PROMPT]\\n  -C, --cd <DIR>\\n'
  exit 0
fi
exit 64
`,
  );
  await chmod(command, 0o755);
  await runCommand("git", ["add", "fake-codex-launch.sh"], repo);
  await runCommand("git", ["commit", "-m", "add fake codex launch"], repo);
  return command;
}

async function fakeClaude(repo: string): Promise<string> {
  const command = join(repo, "fake-claude-launch.sh");
  await writeFile(
    command,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '2.1.156 (Claude Code)\\n'
  exit 0
fi
exit 64
`,
  );
  await chmod(command, 0o755);
  await runCommand("git", ["add", "fake-claude-launch.sh"], repo);
  await runCommand("git", ["commit", "-m", "add fake claude launch"], repo);
  return command;
}

test("launches Codex variants through a fake terminal launcher", async () => {
  const repo = await tempRepo();
  const fakeCodexCommand = await fakeCodex(repo);
  const worktreeA = `${repo}-launch-option-a`;
  const worktreeB = `${repo}-launch-option-b`;
  const captured: AgentLaunchTarget[] = [];
  try {
    const parsed = parseMatrixText(
      `
version: 1
name: codex-launch-run
repo: ${repo}
source:
  backend: codex-cli
  session: source-session
run:
  stateRoot: .state
  concurrency: 2
backend:
  codex:
    command: ${fakeCodexCommand}
variants:
  - name: option-a
    worktree: ${worktreeA}
    prompt: do launch a
  - name: option-b
    worktree: ${worktreeB}
    prompt: do launch b
`,
      "yaml",
    );
    const resolved = await resolveRun(
      parsed.matrix,
      parsed.hash,
      { command: "run", runId: "fake-codex-launch", launch: true, terminal: "zellij" },
      "run",
    );
    const metadata = await launchMatrix(resolved, parsed.hash, {
      terminal: "zellij",
      launcher: async (targets) => {
        captured.push(...targets);
      },
    });

    assert.equal(captured.length, 2);
    assert.deepEqual(captured[0].command.argv.slice(0, 3), [
      fakeCodexCommand,
      "fork",
      "source-session",
    ]);
    assert.match(captured[0].command.argv[3], /Variant: option-a/);
    assert.match(captured[0].command.argv[3], /Variant task:\ndo launch a/);
    assert.deepEqual(captured[0].command.argv.slice(-2), ["-C", worktreeA]);
    assert.equal(metadata.variants.length, 2);
    assert.equal(metadata.launch?.terminal, "zellij");
    assert.equal(metadata.launch?.layout, "tabs");
    assert.equal(metadata.launch?.promptStoragePolicy, "not-persisted");
    assert.doesNotMatch(JSON.stringify(metadata.launch), /node --experimental-strip-types/);
    assert.equal(metadata.variants[0].status, "running");
    assert.equal(metadata.variants[0].sessionId, undefined);
    assert.equal(metadata.variants[0].sessionIdAvailability, "unavailable");
    assert.equal(
      metadata.variants[0].sessionIdUnavailableReason,
      CODEX_LAUNCH_SESSION_UNAVAILABLE_REASON,
    );
    assert.equal(metadata.variants[0].openCommand.kind, "open-worktree");
    assert.deepEqual(metadata.variants[0].openCommand.command.argv, [fakeCodexCommand]);
    assert.deepEqual(metadata.variants[0].verification, []);
    assert.deepEqual(metadata.variants[0].verificationCommands, []);
    assert.deepEqual(metadata.variants[0].changedFiles, []);
    assert.doesNotMatch(JSON.stringify(metadata), /do launch a/);
    assert.doesNotMatch(JSON.stringify(metadata), /fork source-session/);
    assert.doesNotMatch(await readFile(join(resolved.runDir, "report.md"), "utf8"), /do launch a/);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(worktreeA, { recursive: true, force: true });
    await rm(worktreeB, { recursive: true, force: true });
  }
});

test("launches Claude variants through a fake terminal launcher", async () => {
  const repo = await tempRepo();
  const fakeClaudeCommand = await fakeClaude(repo);
  const worktreeA = `${repo}-claude-launch-option-a`;
  try {
    const captured: AgentLaunchTarget[] = [];
    const parsed = parseMatrixText(
      `
version: 1
name: claude-launch-run
repo: ${repo}
source:
  backend: claude-cli
  session: source-session
run:
  stateRoot: .state
backend:
  claude:
    command: ${fakeClaudeCommand}
variants:
  - name: option-a
    worktree: ${worktreeA}
    prompt: do claude launch a
`,
      "yaml",
    );
    const resolved = await resolveRun(
      parsed.matrix,
      parsed.hash,
      { command: "run", runId: "fake-claude-launch", launch: true, terminal: "ghostty" },
      "run",
    );
    const metadata = await launchMatrix(resolved, parsed.hash, {
      terminal: "ghostty",
      launcher: async (targets) => {
        captured.push(...targets);
      },
    });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].command.cwd, worktreeA);
    assert.deepEqual(captured[0].command.argv.slice(0, 6), [
      fakeClaudeCommand,
      "--resume",
      "source-session",
      "--fork-session",
      "--name",
      "fake-claude-launch-option-a",
    ]);
    assert.match(captured[0].command.argv[6], /Variant: option-a/);
    assert.match(captured[0].command.argv[6], /Variant task:\ndo claude launch a/);
    assert.equal(captured[0].command.argv.includes("--worktree"), false);
    assert.equal(metadata.variants.length, 1);
    assert.equal(metadata.launch?.terminal, "ghostty");
    assert.equal(metadata.launch?.layout, "tabs");
    assert.equal(metadata.launch?.launcherStrategy, "ghostty-command-env");
    assert.equal(metadata.variants[0].status, "running");
    assert.equal(metadata.variants[0].sessionId, undefined);
    assert.equal(metadata.variants[0].sessionIdAvailability, "unavailable");
    assert.equal(
      metadata.variants[0].sessionIdUnavailableReason,
      CLAUDE_LAUNCH_SESSION_UNAVAILABLE_REASON,
    );
    assert.equal(metadata.variants[0].openCommand.kind, "open-worktree");
    assert.deepEqual(metadata.variants[0].openCommand.command.argv, [fakeClaudeCommand]);
    assert.deepEqual(metadata.variants[0].verification, []);
    assert.deepEqual(metadata.variants[0].verificationCommands, []);
    assert.doesNotMatch(JSON.stringify(metadata), /do claude launch a/);
    assert.doesNotMatch(JSON.stringify(metadata), /--resume source-session/);
    assert.doesNotMatch(
      await readFile(join(resolved.runDir, "report.md"), "utf8"),
      /do claude launch a/,
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(worktreeA, { recursive: true, force: true });
  }
});

test("launch dry-run omits prompt text and launch commands", async () => {
  const repo = await tempRepo();
  try {
    const parsed = parseMatrixText(
      `
version: 1
name: codex-launch-dry-run
repo: ${repo}
source:
  backend: codex-cli
  session: source-session
variants:
  - name: option-a
    worktree: ${repo}-dry-launch-option-a
    prompt: secret launch prompt
`,
      "yaml",
    );
    const resolved = await resolveRun(
      parsed.matrix,
      parsed.hash,
      { command: "dry-run", launch: true, terminal: "ghostty" },
      "dry-run",
    );
    const text = renderLaunchDryRun(resolved, { terminal: "ghostty", layout: "splits" });
    const json = JSON.stringify(
      launchDryRunJson(resolved, { terminal: "ghostty", layout: "splits" }),
    );

    assert.match(text, /promptSha256:/);
    assert.match(text, /branch:/);
    assert.match(text, /worktree:/);
    assert.match(text, /verification: none/);
    assert.match(text, /launchTarget: ghostty splits/);
    assert.match(json, /"launchTarget"/);
    assert.match(json, /"promptSha256"/);
    assert.doesNotMatch(`${text}\n${json}`, /secret launch prompt/);
    assert.doesNotMatch(`${text}\n${json}`, /codex fork/);
    assert.doesNotMatch(`${text}\n${json}`, /Variant task/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("builds Codex launch targets without persisting them", () => {
  const target = buildCodexLaunchTarget({
    matrix: {
      version: 1,
      name: "codex-target",
      backend: { codex: { command: "/bin/codex" } },
      variants: [{ name: "option-a", prompt: "do a" }],
    },
    sourceSession: "source",
    variant: {
      name: "option-a",
      slug: "option-a",
      prompt: "do a",
      promptSha256: "hash",
      branch: "branch",
      worktree: "/worktree/a",
      artifactDir: "/artifact/a",
      summaryPath: "/artifact/a/summary.md",
      diffPatchPath: "/artifact/a/diff.patch",
      verificationLogPath: "/artifact/a/verification.log",
      metadataPath: "/artifact/a/metadata.json",
      verificationCommands: [],
    },
  });

  assert.deepEqual(target.command.argv.slice(0, 3), ["/bin/codex", "fork", "source"]);
  assert.match(target.command.argv[3], /Variant task:\ndo a/);
  assert.deepEqual(target.command.argv.slice(-2), ["-C", "/worktree/a"]);
});

test("builds Claude launch targets without worktree delegation", () => {
  const target = buildClaudeLaunchTarget({
    matrix: {
      version: 1,
      name: "claude-target",
      backend: { claude: { command: "/bin/claude" } },
      variants: [{ name: "option-a", prompt: "do a" }],
    },
    sourceSession: "source",
    runId: "run-123",
    variant: {
      name: "option-a",
      slug: "option-a",
      prompt: "do a",
      promptSha256: "hash",
      branch: "branch",
      worktree: "/worktree/a",
      artifactDir: "/artifact/a",
      summaryPath: "/artifact/a/summary.md",
      diffPatchPath: "/artifact/a/diff.patch",
      verificationLogPath: "/artifact/a/verification.log",
      metadataPath: "/artifact/a/metadata.json",
      verificationCommands: [],
    },
  });

  assert.equal(target.command.cwd, "/worktree/a");
  assert.deepEqual(target.command.argv.slice(0, 6), [
    "/bin/claude",
    "--resume",
    "source",
    "--fork-session",
    "--name",
    "run-123-option-a",
  ]);
  assert.match(target.command.argv[6], /Variant task:\ndo a/);
  assert.equal(target.command.argv.includes("--worktree"), false);
});
