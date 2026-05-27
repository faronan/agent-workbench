import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderReport, writeVariantSummary } from "../src/report.ts";
import type { RunMetadata, VariantResult } from "../src/types.ts";

function claudeVariant(): VariantResult {
  return {
    name: "A",
    slug: "a",
    status: "succeeded",
    branch: "branch",
    worktree: "/worktree",
    sessionId: "sid",
    openCommand: {
      kind: "resume-session",
      backend: "claude-cli",
      sessionId: "sid",
      sessionIdAvailability: "captured",
      command: {
        cwd: "/worktree",
        argv: ["claude", "--resume", "sid"],
        shellCommand: "cd /worktree && claude --resume sid",
      },
      launchers: {
        ghostty: {
          cwd: "/worktree",
          argv: [
            "open",
            "-na",
            "Ghostty.app",
            "--args",
            "--working-directory=/worktree",
            "-e",
            "claude",
            "--resume",
            "sid",
          ],
          shellCommand:
            "open -na Ghostty.app --args --working-directory=/worktree -e claude --resume sid",
        },
      },
    },
    verification: [],
    diffstat: "",
    changedFiles: ["file.ts"],
    artifactDir: "/artifacts",
  };
}

test("renders report with open commands", () => {
  const metadata: RunMetadata = {
    schemaVersion: 1,
    toolVersion: "0.1.0",
    runId: "run",
    name: "demo",
    createdAt: "now",
    updatedAt: "now",
    repoRoot: "/repo",
    baseRef: "HEAD",
    baseHead: "abc",
    source: { backend: "claude-cli", session: "source" },
    matrixHash: "hash",
    dirtyBase: false,
    dirtyBaseStatus: "",
    variants: [
      claudeVariant(),
      {
        name: "B",
        slug: "b",
        status: "succeeded",
        branch: "branch-b",
        worktree: "/codex-worktree",
        sessionIdAvailability: "unavailable",
        sessionIdUnavailableReason: "Codex CLI does not expose the launched fork session id.",
        openCommand: {
          kind: "open-worktree",
          backend: "codex-cli",
          sessionIdAvailability: "unavailable",
          sessionIdUnavailableReason: "Codex CLI does not expose the launched fork session id.",
          command: {
            cwd: "/codex-worktree",
            argv: ["codex"],
            shellCommand: "cd /codex-worktree && codex",
          },
          launchers: {
            ghostty: {
              cwd: "/codex-worktree",
              argv: [
                "open",
                "-na",
                "Ghostty.app",
                "--args",
                "--working-directory=/codex-worktree",
                "-e",
                "codex",
              ],
              shellCommand:
                "open -na Ghostty.app --args --working-directory=/codex-worktree -e codex",
            },
          },
        },
        verification: [],
        diffstat: "",
        changedFiles: [],
        artifactDir: "/artifacts/b",
      },
    ],
  };
  const report = renderReport(metadata);
  assert.match(report, /cc-fork-matrix report/);
  assert.match(report, /Open/);
  assert.match(report, /cd \/worktree/);
  assert.match(report, /Codex CLI does not expose/);
  assert.doesNotMatch(report, /Resume/);
});

test("writes variant summary with open command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ccfm-report-"));
  const path = join(dir, "summary.md");
  try {
    await writeVariantSummary(path, claudeVariant());
    const summary = await readFile(path, "utf8");
    assert.match(summary, /- Open: `cd \/worktree && claude --resume sid`/);
    assert.doesNotMatch(summary, /Resume/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
