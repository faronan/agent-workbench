import { sha256 } from "./crypto.ts";
import { UserFacingError } from "./errors.ts";
import { runCommand, runInteractiveCommand } from "./shell.ts";
import type {
  AgentLaunchTarget,
  BackendId,
  CommandInvocation,
  CommandResult,
  OpenCommandKind,
} from "./types.ts";

export interface ZellijLaunchOptions {
  command?: string;
  executor?: (command: string, args: string[], cwd: string) => Promise<CommandResult>;
  interactiveExecutor?: (command: string, args: string[], cwd: string) => Promise<CommandResult>;
}

export interface ZellijOpenTab {
  name: string;
  slug: string;
  cwd: string;
  commandKind: OpenCommandKind;
  backend: BackendId;
  command: CommandInvocation;
}

export interface ZellijWorkspacePlan {
  sessionName: string;
  runDir: string;
  layout: "tabs";
  tabs: ZellijOpenTab[];
}

export type ZellijWorkspaceOptions = ZellijLaunchOptions;

const ZELLIJ_SESSION_NAME_MAX_LENGTH = 24;
const ZELLIJ_SESSION_HASH_LENGTH = 16;

function zellijArgs(target: AgentLaunchTarget): string[] {
  return [
    "action",
    "new-tab",
    "--cwd",
    target.worktree,
    "--name",
    target.slug,
    "--",
    ...target.command.argv,
  ];
}

export async function launchZellijTabs(
  targets: AgentLaunchTarget[],
  options: ZellijLaunchOptions = {},
): Promise<void> {
  if (targets.length === 0) {
    throw new UserFacingError("No variants are available to launch in Zellij.");
  }
  const command = options.command ?? "zellij";
  const executor = options.executor ?? runCommand;
  for (const target of targets) {
    const result = await executor(command, zellijArgs(target), process.cwd());
    if (result.code !== 0) {
      throw new UserFacingError(
        [
          `Failed to launch Zellij tab for ${target.name}.`,
          result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : "",
          result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
}

function kdlString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;
}

export function zellijSessionName(runId: string): string {
  const readable = `ccfm-${runId}`;
  if (readable.length <= ZELLIJ_SESSION_NAME_MAX_LENGTH) {
    return readable;
  }
  return `ccfm-${sha256(runId).slice(0, ZELLIJ_SESSION_HASH_LENGTH)}`;
}

export function buildZellijWorkspaceLayout(plan: ZellijWorkspacePlan): string {
  if (plan.tabs.length === 0) {
    throw new UserFacingError("No variants are available to open in Zellij.");
  }
  const lines = ["layout {"];
  for (const tab of plan.tabs) {
    const [command, ...args] = tab.command.argv;
    if (!command) {
      throw new UserFacingError(`Zellij tab ${tab.name} does not have an open command.`);
    }
    lines.push(`    tab name=${kdlString(tab.slug)} cwd=${kdlString(tab.cwd)} {`);
    lines.push("        pane size=1 borderless=true {");
    lines.push('            plugin location="tab-bar"');
    lines.push("        }");
    if (args.length > 0) {
      lines.push(`        pane command=${kdlString(command)} {`);
      lines.push(`            args ${args.map(kdlString).join(" ")}`);
      lines.push("        }");
    } else {
      lines.push(`        pane command=${kdlString(command)}`);
    }
    lines.push("        pane size=1 borderless=true {");
    lines.push('            plugin location="status-bar"');
    lines.push("        }");
    lines.push("    }");
  }
  lines.push("}");
  return lines.join("\n");
}

export function renderZellijOpenDryRun(plan: ZellijWorkspacePlan): string {
  const lines = [
    `Zellij session: ${plan.sessionName}`,
    `Layout: ${plan.layout}`,
    `Run dir: ${plan.runDir}`,
    "",
    "Tabs:",
  ];
  for (const tab of plan.tabs) {
    lines.push(`- ${tab.slug}`);
    lines.push(`  name: ${tab.name}`);
    lines.push(`  cwd: ${tab.cwd}`);
    lines.push(`  commandKind: ${tab.commandKind}`);
    lines.push(`  backend: ${tab.backend}`);
  }
  return `${lines.join("\n")}\n`;
}

export function zellijOpenDryRunJson(plan: ZellijWorkspacePlan): unknown {
  return {
    sessionName: plan.sessionName,
    layout: plan.layout,
    runDir: plan.runDir,
    tabs: plan.tabs.map((tab) => ({
      name: tab.name,
      slug: tab.slug,
      cwd: tab.cwd,
      commandKind: tab.commandKind,
      backend: tab.backend,
    })),
  };
}

function noActiveSessions(result: CommandResult): boolean {
  return /No active zellij sessions found/i.test(`${result.stdout}\n${result.stderr}`);
}

function stripAnsi(value: string): string {
  const escapeChar = String.fromCharCode(27);
  return value.replace(new RegExp(`${escapeChar}\\[[0-9;]*m`, "g"), "");
}

function outputLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(stripAnsi)
    .map((line) => line.trim())
    .filter(Boolean);
}

type ZellijSessionState = "active" | "exited" | "absent";

function parseZellijSessionState(output: string, sessionName: string): ZellijSessionState {
  const line = outputLines(output).find(
    (line) => line === sessionName || line.startsWith(`${sessionName} `),
  );
  if (!line) {
    return "absent";
  }
  return /\(EXITED\b/.test(line) ? "exited" : "active";
}

async function zellijSessionState(
  sessionName: string,
  command: string,
  executor: NonNullable<ZellijLaunchOptions["executor"]>,
): Promise<ZellijSessionState> {
  const result = await executor(command, ["list-sessions"], process.cwd());
  if (result.code !== 0) {
    if (noActiveSessions(result)) {
      return "absent";
    }
    throw new UserFacingError(
      [
        "Failed to list Zellij sessions.",
        result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : "",
        result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return parseZellijSessionState(result.stdout, sessionName);
}

export async function launchZellijWorkspace(
  plan: ZellijWorkspacePlan,
  options: ZellijWorkspaceOptions = {},
): Promise<void> {
  if (plan.tabs.length === 0) {
    throw new UserFacingError("No variants are available to open in Zellij.");
  }
  const command = options.command ?? "zellij";
  const executor = options.executor ?? runCommand;
  const interactiveExecutor = options.interactiveExecutor ?? runInteractiveCommand;
  const sessionState = await zellijSessionState(plan.sessionName, command, executor);
  if (sessionState === "exited") {
    throw new UserFacingError(
      [
        `Zellij session ${plan.sessionName} exists but is exited.`,
        "Delete it before re-opening this run:",
        `  zellij delete-session --force ${plan.sessionName}`,
      ].join("\n"),
    );
  }
  const args =
    sessionState === "active"
      ? ["attach", plan.sessionName]
      : [
          "--layout-string",
          buildZellijWorkspaceLayout(plan),
          "options",
          "--session-name",
          plan.sessionName,
        ];
  const result = await interactiveExecutor(command, args, process.cwd());
  if (result.code !== 0) {
    throw new UserFacingError(
      [
        `Failed to ${
          sessionState === "active" ? "attach to" : "create"
        } Zellij session ${plan.sessionName}.`,
        result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : "",
        result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}
