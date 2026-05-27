import assert from "node:assert/strict";
import test from "node:test";
import { buildVariantOpenCommand } from "../src/open-command.ts";
import type { MatrixDefinition, ResolvedVariant } from "../src/types.ts";

const variant: ResolvedVariant = {
  name: "Option A",
  slug: "option-a",
  prompt: "do not serialize me",
  promptSha256: "hash",
  branch: "branch",
  worktree: "/work tree/option-a",
  artifactDir: "/artifacts",
  summaryPath: "/artifacts/summary.md",
  diffPatchPath: "/artifacts/diff.patch",
  verificationLogPath: "/artifacts/verification.log",
  metadataPath: "/artifacts/metadata.json",
  verificationCommands: [],
};

test("builds Codex resume command when session id is captured", () => {
  const matrix: MatrixDefinition = {
    version: 1,
    name: "demo",
    backend: {
      codex: {
        command: "/bin/codex",
      },
    },
    variants: [{ name: "Option A", prompt: "do a" }],
  };

  const openCommand = buildVariantOpenCommand({
    backend: "codex-cli",
    matrix,
    variant,
    sessionId: "codex-session",
  });

  assert.equal(openCommand.kind, "resume-session");
  assert.equal(openCommand.backend, "codex-cli");
  assert.deepEqual(openCommand.command.argv, ["/bin/codex", "resume", "codex-session"]);
  assert.equal(
    openCommand.command.shellCommand,
    "cd '/work tree/option-a' && '/bin/codex' 'resume' 'codex-session'",
  );
});

test("builds open-worktree command when session id is unknown", () => {
  const matrix: MatrixDefinition = {
    version: 1,
    name: "demo",
    backend: {
      claude: {
        command: "/bin/claude",
      },
    },
    variants: [{ name: "Option A", prompt: "do a" }],
  };

  const openCommand = buildVariantOpenCommand({
    backend: "claude-cli",
    matrix,
    variant,
    sessionIdAvailability: "unavailable",
    sessionIdUnavailableReason: "session id was not captured",
  });

  assert.equal(openCommand.kind, "open-worktree");
  assert.equal(openCommand.sessionIdAvailability, "unavailable");
  assert.equal(openCommand.sessionIdUnavailableReason, "session id was not captured");
  assert.deepEqual(openCommand.command.argv, ["/bin/claude"]);
});
