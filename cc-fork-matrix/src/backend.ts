import { UserFacingError } from "./errors.ts";
import { buildVariantPrompt } from "./prompt.ts";
import { runCommand, runInteractiveCommand } from "./shell.ts";
import type { BackendId, BackendRunResult, MatrixDefinition, ResolvedVariant } from "./types.ts";

export interface AgentBackend {
  checkAvailability(): Promise<void>;
  startForkedSession(args: {
    repoRoot: string;
    sourceSession: string;
    runId: string;
    variant: ResolvedVariant;
    matrix: MatrixDefinition;
  }): Promise<BackendRunResult>;
}

function parseJsonLine(text: string): Record<string, unknown> | null {
  for (const line of text.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Keep scanning earlier lines.
    }
  }
  return null;
}

function extractSessionId(stdout: string, stderr: string): string | undefined {
  const parsed = parseJsonLine(stdout) ?? parseJsonLine(stderr);
  const candidates = [
    parsed?.session_id,
    parsed?.sessionId,
    parsed?.sessionID,
    parsed?.id,
    stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0],
    stderr.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0],
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

function extractSummary(stdout: string): string {
  const parsed = parseJsonLine(stdout);
  const result = parsed?.result ?? parsed?.summary ?? parsed?.message;
  if (typeof result === "string") {
    return result;
  }
  return stdout.trim().slice(0, 4000);
}

function assertCodexForkHelp(command: string, text: string): void {
  const hasUsage = text.includes("Usage: codex fork");
  const hasSessionId = text.includes("[SESSION_ID]");
  const hasWorkdirFlag = text.includes("-C") || text.includes("--cd");
  if (!hasUsage || !hasSessionId || !hasWorkdirFlag) {
    throw new UserFacingError(
      `Codex CLI "${command}" does not expose the expected fork surface. Expected "codex fork [SESSION_ID] [PROMPT]" with -C/--cd.`,
    );
  }
}

export class ClaudeCliBackend implements AgentBackend {
  private readonly command: string;

  constructor(command: string) {
    this.command = command;
  }

  async checkAvailability(): Promise<void> {
    const result = await runCommand(this.command, ["--version"], process.cwd());
    if (result.code !== 0) {
      throw new UserFacingError(
        `Claude CLI is not available as "${this.command}". Install it or set backend.claude.command.`,
      );
    }
  }

  async startForkedSession(args: {
    repoRoot: string;
    sourceSession: string;
    runId: string;
    variant: ResolvedVariant;
    matrix: MatrixDefinition;
  }): Promise<BackendRunResult> {
    const claude = args.matrix.backend?.claude ?? {};
    const prompt = buildVariantPrompt(args.variant);
    const cliArgs = [
      "-p",
      "--resume",
      args.sourceSession,
      "--fork-session",
      "--name",
      `${args.runId}-${args.variant.slug}`,
      "--output-format",
      "json",
    ];
    if (claude.permissionMode) {
      cliArgs.push("--permission-mode", claude.permissionMode);
    }
    if (claude.maxTurns) {
      cliArgs.push("--max-turns", String(claude.maxTurns));
    }
    cliArgs.push(prompt);
    const result = await runCommand(this.command, cliArgs, args.variant.worktree);
    const sessionId = extractSessionId(result.stdout, result.stderr);
    return {
      status: result.code === 0 ? "success" : "failed",
      exitCode: result.code,
      signal: result.signal,
      sessionId,
      sessionIdAvailability: sessionId ? "captured" : undefined,
      summary: extractSummary(result.stdout),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

export class CodexCliBackend implements AgentBackend {
  private readonly command: string;

  constructor(command: string) {
    this.command = command;
  }

  async checkAvailability(): Promise<void> {
    const result = await runCommand(this.command, ["fork", "--help"], process.cwd());
    if (result.code !== 0) {
      throw new UserFacingError(
        `Codex CLI is not available as "${this.command}". Install it or set backend.codex.command.`,
      );
    }
    assertCodexForkHelp(this.command, `${result.stdout}\n${result.stderr}`);
  }

  async startForkedSession(args: {
    repoRoot: string;
    sourceSession: string;
    runId: string;
    variant: ResolvedVariant;
    matrix: MatrixDefinition;
  }): Promise<BackendRunResult> {
    const prompt = buildVariantPrompt(args.variant);
    const cliArgs = ["fork", args.sourceSession, prompt, "-C", args.variant.worktree];
    const result = await runInteractiveCommand(this.command, cliArgs, args.repoRoot);
    const status =
      result.signal === "SIGINT" || result.signal === "SIGTERM"
        ? "interrupted"
        : result.code === 0
          ? "success"
          : "failed";
    return {
      status,
      exitCode: result.code,
      signal: result.signal,
      sessionIdAvailability: "unavailable",
      sessionIdUnavailableReason:
        "Codex CLI does not expose the launched fork session id in interactive launcher mode.",
      summary: "",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

export function createBackend(id: BackendId, matrix: MatrixDefinition): AgentBackend {
  if (id === "claude-cli") {
    return new ClaudeCliBackend(matrix.backend?.claude?.command ?? "claude");
  }
  if (id === "codex-cli") {
    return new CodexCliBackend(matrix.backend?.codex?.command ?? "codex");
  }
  throw new UserFacingError(`${id} backend is reserved for a future release.`);
}
