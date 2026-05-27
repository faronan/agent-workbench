import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UserFacingError } from "../src/errors.ts";
import { printOpenCommand } from "../src/open.ts";
import type { RunMetadata } from "../src/types.ts";

function metadata(): RunMetadata {
  return {
    schemaVersion: 1,
    toolVersion: "0.1.0",
    runId: "run",
    name: "demo",
    createdAt: "now",
    updatedAt: "now",
    repoRoot: "/repo",
    baseRef: "HEAD",
    baseHead: "abc",
    source: { backend: "codex-cli", session: "source" },
    matrixHash: "hash",
    dirtyBase: false,
    dirtyBaseStatus: "",
    variants: [
      {
        name: "Claude A",
        slug: "claude-a",
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
      {
        name: "Codex B",
        slug: "codex-b",
        status: "succeeded",
        branch: "branch-b",
        worktree: "/worktree/b",
        sessionIdAvailability: "unavailable",
        sessionIdUnavailableReason: "Codex CLI does not expose the launched fork session id.",
        openCommand: {
          kind: "open-worktree",
          backend: "codex-cli",
          sessionIdAvailability: "unavailable",
          sessionIdUnavailableReason: "Codex CLI does not expose the launched fork session id.",
          command: {
            cwd: "/worktree/b",
            argv: ["codex"],
            shellCommand: "cd /worktree/b && codex",
          },
          launchers: {
            ghostty: {
              cwd: "/worktree/b",
              argv: [
                "open",
                "-na",
                "Ghostty.app",
                "--args",
                "--working-directory=/worktree/b",
                "-e",
                "codex",
              ],
              shellCommand: "open -na Ghostty.app --args --working-directory=/worktree/b -e codex",
            },
          },
        },
        verification: [],
        diffstat: "",
        changedFiles: [],
        artifactDir: "/artifact/b",
      },
    ],
  };
}

async function withRunDir(fn: (runDir: string) => Promise<void>): Promise<void> {
  const runDir = await mkdtemp(join(tmpdir(), "ccfm-open-"));
  try {
    await writeFile(join(runDir, "metadata.json"), `${JSON.stringify(metadata(), null, 2)}\n`);
    await fn(runDir);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

test("prints shell open commands for all variants", async () => {
  await withRunDir(async (runDir) => {
    assert.equal(
      await printOpenCommand(runDir),
      "cd /worktree/a && claude --resume sid-a\ncd /worktree/b && codex\n",
    );
  });
});

test("prints shell open command for selected variant", async () => {
  await withRunDir(async (runDir) => {
    assert.equal(await printOpenCommand(runDir, "codex-b"), "cd /worktree/b && codex\n");
  });
});

test("prints structured open command json", async () => {
  await withRunDir(async (runDir) => {
    const payload = JSON.parse(await printOpenCommand(runDir, "codex-b", { json: true }));
    assert.equal(payload[0].name, "Codex B");
    assert.equal(payload[0].openCommand.kind, "open-worktree");
    assert.deepEqual(payload[0].openCommand.command.argv, ["codex"]);
    assert.match(payload[0].openCommand.launchers.ghostty.shellCommand, /Ghostty\.app/);
  });
});

test("fails when selected variant does not exist", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => printOpenCommand(runDir, "missing"),
      (error) => error instanceof UserFacingError && /No variant found/.test(error.message),
    );
  });
});
