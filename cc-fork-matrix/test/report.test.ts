import assert from "node:assert/strict";
import test from "node:test";
import { renderReport } from "../src/report.ts";
import type { RunMetadata } from "../src/types.ts";

test("renders report with open command", () => {
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
      {
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
        },
        verification: [],
        diffstat: "",
        changedFiles: ["file.ts"],
        artifactDir: "/artifacts",
      },
    ],
  };
  const report = renderReport(metadata);
  assert.match(report, /cc-fork-matrix report/);
  assert.match(report, /Open/);
  assert.match(report, /cd \/worktree/);
  assert.doesNotMatch(report, /Resume/);
});
