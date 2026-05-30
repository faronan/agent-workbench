import assert from "node:assert/strict";
import test from "node:test";
import { UserFacingError } from "../src/errors.ts";
import type { CodexLaunchTarget, CommandInvocation, CommandResult } from "../src/types.ts";
import {
  buildZellijWorkspaceLayout,
  launchZellijTabs,
  launchZellijWorkspace,
  type ZellijWorkspacePlan,
  zellijSessionName,
} from "../src/zellij.ts";

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

const openCommand: CommandInvocation = {
  cwd: "/worktree/a",
  argv: ["codex", "resume", "sid-a"],
  shellCommand: "cd /worktree/a && codex resume sid-a",
};

const workspacePlan: ZellijWorkspacePlan = {
  sessionName: "ccfm-run",
  runDir: "/state/runs/run",
  layout: "tabs",
  tabs: [
    {
      name: "Option A",
      slug: "option-a",
      cwd: "/worktree/a",
      commandKind: "resume-session",
      backend: "codex-cli",
      command: openCommand,
    },
  ],
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

test("builds a Zellij workspace layout from open commands", () => {
  const layout = buildZellijWorkspaceLayout(workspacePlan);

  assert.match(layout, /layout \{/);
  assert.match(layout, /tab name="option-a" cwd="\/worktree\/a"/);
  assert.match(layout, /plugin location="tab-bar"/);
  assert.match(layout, /pane command="codex"/);
  assert.match(layout, /args "resume" "sid-a"/);
  assert.match(layout, /plugin location="status-bar"/);
  assert.doesNotMatch(layout, /cd \/worktree/);
});

test("keeps Zellij workspace session names within Zellij 0.44 limits", () => {
  assert.equal(zellijSessionName("run"), "ccfm-run");

  const longName = zellijSessionName("codex-zellij-open-smoke");
  assert.match(longName, /^ccfm-[a-f0-9]{16}$/);
  assert.equal(longName.length <= 24, true);
});

test("creates a Zellij workspace session when no session exists", async () => {
  const listCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const interactiveCalls: Array<{ command: string; args: string[]; cwd: string }> = [];

  await launchZellijWorkspace(workspacePlan, {
    command: "fake-zellij",
    executor: async (command, args, cwd): Promise<CommandResult> => {
      listCalls.push({ command, args, cwd });
      return { code: 1, signal: null, stdout: "No active zellij sessions found.\n", stderr: "" };
    },
    interactiveExecutor: async (command, args, cwd): Promise<CommandResult> => {
      interactiveCalls.push({ command, args, cwd });
      return { code: 0, signal: null, stdout: "", stderr: "" };
    },
  });

  assert.equal(listCalls.length, 1);
  assert.equal(interactiveCalls.length, 1);
  assert.deepEqual(listCalls[0].args, ["list-sessions"]);
  assert.equal(interactiveCalls[0].args[0], "--layout-string");
  assert.match(interactiveCalls[0].args[1], /tab name="option-a"/);
  assert.deepEqual(interactiveCalls[0].args.slice(2), ["options", "--session-name", "ccfm-run"]);
});

test("attaches to an existing Zellij workspace session without creating duplicate tabs", async () => {
  const listCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const interactiveCalls: Array<{ command: string; args: string[]; cwd: string }> = [];

  await launchZellijWorkspace(workspacePlan, {
    command: "fake-zellij",
    executor: async (command, args, cwd): Promise<CommandResult> => {
      listCalls.push({ command, args, cwd });
      return {
        code: 0,
        signal: null,
        stdout: "other [Created now]\nccfm-run [Created now]\n",
        stderr: "",
      };
    },
    interactiveExecutor: async (command, args, cwd): Promise<CommandResult> => {
      interactiveCalls.push({ command, args, cwd });
      return { code: 0, signal: null, stdout: "", stderr: "" };
    },
  });

  assert.equal(listCalls.length, 1);
  assert.equal(interactiveCalls.length, 1);
  assert.deepEqual(listCalls[0].args, ["list-sessions"]);
  assert.deepEqual(interactiveCalls[0].args, ["attach", "ccfm-run"]);
});

test("refuses to resurrect an exited Zellij workspace session", async () => {
  const interactiveCalls: Array<{ command: string; args: string[]; cwd: string }> = [];

  await assert.rejects(
    () =>
      launchZellijWorkspace(workspacePlan, {
        command: "fake-zellij",
        executor: async (): Promise<CommandResult> => ({
          code: 0,
          signal: null,
          stdout:
            "\u001b[32;1mccfm-run\u001b[m [Created now] (\u001b[31;1mEXITED\u001b[m - attach to resurrect)\n",
          stderr: "",
        }),
        interactiveExecutor: async (command, args, cwd): Promise<CommandResult> => {
          interactiveCalls.push({ command, args, cwd });
          return { code: 0, signal: null, stdout: "", stderr: "" };
        },
      }),
    (error) =>
      error instanceof UserFacingError &&
      /Zellij session ccfm-run exists but is exited/.test(error.message) &&
      /zellij delete-session --force ccfm-run/.test(error.message),
  );

  assert.equal(interactiveCalls.length, 0);
});
