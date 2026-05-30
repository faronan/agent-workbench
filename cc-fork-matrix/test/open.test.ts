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
        verificationCommands: [],
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
        verificationCommands: [],
        diffstat: "",
        changedFiles: [],
        artifactDir: "/artifact/b",
      },
      {
        name: "Unavailable C",
        slug: "unavailable-c",
        status: "fork_failed",
        branch: "branch-c",
        worktree: "/worktree/c",
        openCommand: {
          kind: "unavailable",
          backend: "claude-agent-sdk",
          sessionIdAvailability: "unavailable",
          sessionIdUnavailableReason: "Worktree was not created.",
        },
        verification: [],
        verificationCommands: [],
        diffstat: "",
        changedFiles: [],
        artifactDir: "/artifact/c",
      },
    ],
  };
}

function availableMetadata(): RunMetadata {
  const value = metadata();
  value.variants = value.variants.slice(0, 2);
  return value;
}

async function withRunDir(
  fn: (runDir: string) => Promise<void>,
  runMetadata: RunMetadata = metadata(),
): Promise<void> {
  const runDir = await mkdtemp(join(tmpdir(), "ccfm-open-"));
  try {
    await writeFile(join(runDir, "metadata.json"), `${JSON.stringify(runMetadata, null, 2)}\n`);
    await fn(runDir);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

test("prints shell open commands for all variants", async () => {
  await withRunDir(async (runDir) => {
    assert.equal(
      await printOpenCommand(runDir),
      [
        "cd /worktree/a && claude --resume sid-a",
        "cd /worktree/b && codex",
        "# Unavailable C: Worktree was not created.",
        "",
      ].join("\n"),
    );
  });
});

test("prints shell open command for selected variant", async () => {
  await withRunDir(async (runDir) => {
    assert.equal(await printOpenCommand(runDir, "codex-b"), "cd /worktree/b && codex\n");
  });
});

test("prints structured open command json with launcher metadata", async () => {
  await withRunDir(async (runDir) => {
    const payload = JSON.parse(await printOpenCommand(runDir, "codex-b", { json: true }));
    assert.equal(payload[0].name, "Codex B");
    assert.equal(payload[0].openCommand.kind, "open-worktree");
    assert.deepEqual(payload[0].openCommand.command.argv, ["codex"]);
    assert.match(payload[0].openCommand.launchers.ghostty.shellCommand, /Ghostty\.app/);
  });
});

test("prints Ghostty dry-run output for selected variant", async () => {
  await withRunDir(async (runDir) => {
    const output = await printOpenCommand(runDir, "codex-b", {
      terminal: "ghostty",
      layout: "splits",
      dryRun: true,
    });
    assert.match(output, /Ghostty layout: splits/);
    assert.match(output, /Manual commands:/);
    assert.match(output, /- Codex B: cd \/worktree\/b && codex/);
    assert.match(output, /AppleScript:/);
    assert.match(output, /tell application "Ghostty"/);
  });
});

test("rejects Ghostty launch when selected variants include unavailable commands", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => printOpenCommand(runDir, undefined, { terminal: "ghostty", dryRun: true }),
      (error) =>
        error instanceof UserFacingError &&
        /Cannot open all selected variants in Ghostty/.test(error.message) &&
        /Unavailable C/.test(error.message) &&
        /Manual commands/.test(error.message),
    );
  });
});

test("prints Zellij dry-run output without shell commands", async () => {
  await withRunDir(async (runDir) => {
    const output = await printOpenCommand(runDir, undefined, {
      terminal: "zellij",
      dryRun: true,
    });

    assert.match(output, /Zellij session: ccfm-run/);
    assert.match(output, /Layout: tabs/);
    assert.match(output, /- claude-a/);
    assert.match(output, /name: Claude A/);
    assert.match(output, /cwd: \/worktree\/a/);
    assert.match(output, /commandKind: resume-session/);
    assert.match(output, /backend: claude-cli/);
    assert.doesNotMatch(output, /claude --resume/);
    assert.doesNotMatch(output, /cd \/worktree/);
  }, availableMetadata());
});

test("prints Zellij dry-run json without launch commands", async () => {
  await withRunDir(async (runDir) => {
    const output = await printOpenCommand(runDir, undefined, {
      terminal: "zellij",
      dryRun: true,
      json: true,
    });
    const payload = JSON.parse(output);

    assert.equal(payload.sessionName, "ccfm-run");
    assert.equal(payload.layout, "tabs");
    assert.equal(payload.tabs[0].slug, "claude-a");
    assert.equal(payload.tabs[0].cwd, "/worktree/a");
    assert.equal(payload.tabs[0].commandKind, "resume-session");
    assert.equal(payload.tabs[0].backend, "claude-cli");
    assert.doesNotMatch(output, /shellCommand/);
    assert.doesNotMatch(output, /claude --resume/);
  }, availableMetadata());
});

test("rejects Zellij open when selected variants include unavailable commands", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => printOpenCommand(runDir, undefined, { terminal: "zellij", dryRun: true }),
      (error) =>
        error instanceof UserFacingError &&
        /Cannot open all selected variants in Zellij/.test(error.message) &&
        /Unavailable C/.test(error.message),
    );
  });
});

test("rejects Zellij open with a selected variant", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => printOpenCommand(runDir, "codex-b", { terminal: "zellij", dryRun: true }),
      (error) =>
        error instanceof UserFacingError &&
        /open --terminal zellij opens the full run/.test(error.message),
    );
  }, availableMetadata());
});

test("rejects Zellij json launch without dry-run", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => printOpenCommand(runDir, undefined, { terminal: "zellij", json: true }),
      (error) =>
        error instanceof UserFacingError &&
        /--json can only be combined with --terminal zellij when --dry-run is set/.test(
          error.message,
        ),
    );
  }, availableMetadata());
});

test("rejects Zellij split layout", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () =>
        printOpenCommand(runDir, undefined, {
          terminal: "zellij",
          layout: "splits",
          dryRun: true,
        }),
      (error) =>
        error instanceof UserFacingError &&
        /zellij open mode only supports the tabs layout/.test(error.message),
    );
  }, availableMetadata());
});

test("rejects json with Ghostty terminal mode", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => printOpenCommand(runDir, "codex-b", { terminal: "ghostty", json: true }),
      (error) =>
        error instanceof UserFacingError && /--json cannot be combined/.test(error.message),
    );
  });
});

test("rejects layout without Ghostty terminal mode", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => printOpenCommand(runDir, "codex-b", { layout: "tabs" }),
      (error) =>
        error instanceof UserFacingError &&
        /--layout requires --terminal ghostty/.test(error.message),
    );
  });
});

test("rejects dry-run without Ghostty terminal mode", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () => printOpenCommand(runDir, "codex-b", { dryRun: true }),
      (error) =>
        error instanceof UserFacingError &&
        /open --dry-run requires --terminal ghostty/.test(error.message),
    );
  });
});

test("includes manual commands when Ghostty AppleScript launch fails", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      () =>
        printOpenCommand(runDir, "codex-b", {
          terminal: "ghostty",
          ghostty: {
            platform: "darwin",
            ghosttyAppPath: runDir,
            osascriptPath: "/bin/sh",
            executor: async () => ({
              code: 1,
              signal: null,
              stdout: "",
              stderr: "Not authorized to send Apple events to Ghostty.",
            }),
          },
        }),
      (error) =>
        error instanceof UserFacingError &&
        /TCC/.test(error.message) &&
        /Manual commands/.test(error.message) &&
        /cd \/worktree\/b && codex/.test(error.message),
    );
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
