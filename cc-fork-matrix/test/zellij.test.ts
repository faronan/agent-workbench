import assert from "node:assert/strict";
import test from "node:test";
import { UserFacingError } from "../src/errors.ts";
import type { CodexLaunchTarget, CommandResult } from "../src/types.ts";
import { launchZellijTabs } from "../src/zellij.ts";

const target: CodexLaunchTarget = {
  name: "Option A",
  slug: "option-a",
  branch: "branch-a",
  worktree: "/worktree/a",
  promptSha256: "hash-a",
  command: {
    cwd: "/worktree/a",
    argv: ["codex", "fork", "source-session", "prompt body", "-C", "/worktree/a"],
    shellCommand: "cd /worktree/a && codex fork source-session 'prompt body' -C /worktree/a",
  },
};

test("launches each Codex target in a Zellij tab with a fake executor", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  await launchZellijTabs([target], {
    command: "fake-zellij",
    executor: async (command, args, cwd): Promise<CommandResult> => {
      calls.push({ command, args, cwd });
      return { code: 0, signal: null, stdout: "terminal_1\n", stderr: "" };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "fake-zellij");
  assert.deepEqual(calls[0].args, [
    "action",
    "new-tab",
    "--cwd",
    "/worktree/a",
    "--name",
    "option-a",
    "--",
    "codex",
    "fork",
    "source-session",
    "prompt body",
    "-C",
    "/worktree/a",
  ]);
});

test("reports Zellij launch failures without running a real terminal", async () => {
  await assert.rejects(
    () =>
      launchZellijTabs([target], {
        command: "fake-zellij",
        executor: async () => ({
          code: 1,
          signal: null,
          stdout: "",
          stderr: "not inside zellij",
        }),
      }),
    (error) =>
      error instanceof UserFacingError &&
      /Failed to launch Zellij tab for Option A/.test(error.message) &&
      /not inside zellij/.test(error.message),
  );
});
