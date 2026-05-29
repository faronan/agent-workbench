import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { UserFacingError } from "./errors.ts";
import { runCommand } from "./shell.ts";
import type { CommandInvocation, CommandResult, GhosttyLayout } from "./types.ts";

const DEFAULT_GHOSTTY_APP_PATH = "/Applications/Ghostty.app";
const DEFAULT_OSASCRIPT_PATH = "/usr/bin/osascript";
const BASH_INDIRECT_VAR = "$" + "{!var}";
const BASH_ARGS_ARRAY = "$" + "{args[@]}";
const HIDDEN_ARG_RUNNER = [
  "/bin/bash -lc 'decode_arg() { local decoded;",
  'if decoded=$(printf %s "$1" | base64 --decode 2>/dev/null); then',
  'printf %s "$decoded"; else printf %s "$1" | base64 -D; fi; };',
  "args=(); for ((i=0; i<CC_FORK_MATRIX_ARGC; i++)); do",
  'var="CC_FORK_MATRIX_ARG_B64_$i";',
  `args+=("$(decode_arg "${BASH_INDIRECT_VAR}")");`,
  'unset "$var"; done; unset CC_FORK_MATRIX_ARGC;',
  `exec "${BASH_ARGS_ARRAY}"'`,
].join(" ");

export interface GhosttyOpenTarget {
  name: string;
  slug: string;
  command: CommandInvocation;
}

export interface GhosttyLaunchOptions {
  layout: GhosttyLayout;
  platform?: NodeJS.Platform;
  ghosttyAppPath?: string;
  osascriptPath?: string;
  executor?: (script: string) => Promise<CommandResult>;
}

function applescriptString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

function cfgName(index: number): string {
  return `cfg${index}`;
}

function termName(index: number): string {
  return `term${index}`;
}

function addConfigLines(lines: string[], target: GhosttyOpenTarget, index: number): void {
  const cfg = cfgName(index);
  lines.push(`  set ${cfg} to new surface configuration`);
  lines.push(
    `  set initial working directory of ${cfg} to ${applescriptString(target.command.cwd)}`,
  );
  if (target.command.containsSensitiveArgs) {
    lines.push(`  set command of ${cfg} to ${applescriptString(HIDDEN_ARG_RUNNER)}`);
    lines.push(
      `  set environment variables of ${cfg} to ${applescriptStringList(commandEnvironment(target.command))}`,
    );
  }
}

function addCommandInputLines(lines: string[], target: GhosttyOpenTarget, index: number): void {
  if (target.command.containsSensitiveArgs) {
    return;
  }
  const term = termName(index);
  lines.push(`  input text ${applescriptString(target.command.shellCommand)} to ${term}`);
  lines.push(`  send key "enter" to ${term}`);
}

function applescriptStringList(values: string[]): string {
  return `{${values.map(applescriptString).join(", ")}}`;
}

function commandEnvironment(command: CommandInvocation): string[] {
  return [
    `PATH=${process.env.PATH ?? ""}`,
    `CC_FORK_MATRIX_ARGC=${command.argv.length}`,
    ...command.argv.map(
      (arg, index) =>
        `CC_FORK_MATRIX_ARG_B64_${index}=${Buffer.from(arg, "utf8").toString("base64")}`,
    ),
  ];
}

function buildTabsScript(targets: GhosttyOpenTarget[]): string[] {
  const lines: string[] = [];
  targets.forEach((target, index) => {
    addConfigLines(lines, target, index + 1);
  });
  lines.push(`  set win to new window with configuration ${cfgName(1)}`);
  lines.push("  set term1 to focused terminal of selected tab of win");
  addCommandInputLines(lines, targets[0], 1);
  for (let index = 1; index < targets.length; index += 1) {
    const number = index + 1;
    lines.push(`  set tab${number} to new tab in win with configuration ${cfgName(number)}`);
    lines.push(`  set ${termName(number)} to focused terminal of tab${number}`);
    addCommandInputLines(lines, targets[index], number);
  }
  return lines;
}

function buildSplitsScript(targets: GhosttyOpenTarget[]): string[] {
  const lines: string[] = [];
  targets.forEach((target, index) => {
    addConfigLines(lines, target, index + 1);
  });
  lines.push(`  set win to new window with configuration ${cfgName(1)}`);
  lines.push("  set term1 to focused terminal of selected tab of win");
  addCommandInputLines(lines, targets[0], 1);
  for (let index = 1; index < targets.length; index += 1) {
    const number = index + 1;
    const previous = termName(number - 1);
    const direction = index % 2 === 1 ? "right" : "down";
    lines.push(
      `  set ${termName(number)} to split ${previous} direction ${direction} with configuration ${cfgName(number)}`,
    );
    addCommandInputLines(lines, targets[index], number);
  }
  return lines;
}

export function buildGhosttyAppleScript(
  targets: GhosttyOpenTarget[],
  layout: GhosttyLayout,
): string {
  if (targets.length === 0) {
    throw new UserFacingError("No variants are available to open in Ghostty.");
  }
  const body = layout === "tabs" ? buildTabsScript(targets) : buildSplitsScript(targets);
  return [
    'tell application "Ghostty"',
    "  activate",
    ...body,
    "  activate window win",
    "end tell",
  ].join("\n");
}

export function renderManualCommands(targets: GhosttyOpenTarget[]): string {
  return targets
    .map(
      (target) =>
        `- ${target.name}: ${target.command.displayShellCommand ?? target.command.shellCommand}`,
    )
    .join("\n");
}

export function renderGhosttyDryRun(targets: GhosttyOpenTarget[], layout: GhosttyLayout): string {
  return [
    `Ghostty layout: ${layout}`,
    "",
    "Manual commands:",
    renderManualCommands(targets),
    "",
    "AppleScript:",
    buildGhosttyAppleScript(targets, layout),
    "",
  ].join("\n");
}

async function assertReadable(
  path: string,
  label: string,
  targets: GhosttyOpenTarget[],
): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch {
    throw new UserFacingError(
      `${label} was not found at ${path}.\n\nManual commands:\n${renderManualCommands(targets)}`,
    );
  }
}

async function assertExecutable(
  path: string,
  label: string,
  targets: GhosttyOpenTarget[],
): Promise<void> {
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new UserFacingError(
      `${label} was not found or is not executable at ${path}.\n\nManual commands:\n${renderManualCommands(targets)}`,
    );
  }
}

export async function launchGhostty(
  targets: GhosttyOpenTarget[],
  options: GhosttyLaunchOptions,
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new UserFacingError(
      `Ghostty launcher is only supported on macOS.\n\nManual commands:\n${renderManualCommands(targets)}`,
    );
  }
  const ghosttyAppPath = options.ghosttyAppPath ?? DEFAULT_GHOSTTY_APP_PATH;
  const osascriptPath = options.osascriptPath ?? DEFAULT_OSASCRIPT_PATH;
  await assertReadable(ghosttyAppPath, "Ghostty.app", targets);
  await assertExecutable(osascriptPath, "osascript", targets);

  const script = buildGhosttyAppleScript(targets, options.layout);
  const executor =
    options.executor ??
    ((scriptText: string) => runCommand(osascriptPath, [], process.cwd(), { input: scriptText }));
  const result = await executor(script);
  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    throw new UserFacingError(
      [
        "Failed to launch Ghostty with AppleScript.",
        "macOS Automation (TCC) permission for Ghostty may be required.",
        stderr ? `stderr: ${stderr}` : "",
        stdout ? `stdout: ${stdout}` : "",
        "",
        "Manual commands:",
        renderManualCommands(targets),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}
