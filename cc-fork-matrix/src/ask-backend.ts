import { UserFacingError } from "./errors.ts";
import { buildAskQuestionPrompt } from "./prompt.ts";
import { runCommand } from "./shell.ts";
import type { AskBackendResult, AskDefinition, BackendId, ResolvedAskQuestion } from "./types.ts";

export interface AskBackend {
  checkAvailability(): Promise<void>;
  askQuestion(args: {
    repoRoot: string;
    sourceSession: string;
    runId: string;
    question: ResolvedAskQuestion;
    config: AskDefinition;
  }): Promise<AskBackendResult>;
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

function extractSummary(stdout: string): string | undefined {
  const parsed = parseJsonLine(stdout);
  const result = parsed?.result ?? parsed?.summary ?? parsed?.message;
  return typeof result === "string" ? result : undefined;
}

export class ClaudeAskBackend implements AskBackend {
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

  async askQuestion(args: {
    repoRoot: string;
    sourceSession: string;
    runId: string;
    question: ResolvedAskQuestion;
    config: AskDefinition;
  }): Promise<AskBackendResult> {
    const claude = args.config.backend?.claude ?? {};
    const prompt = buildAskQuestionPrompt(args.question);
    const cliArgs = [
      "-p",
      "--resume",
      args.sourceSession,
      "--fork-session",
      "--name",
      `${args.runId}-${args.question.slug}`,
      "--output-format",
      "json",
      "--tools",
      "",
      "--permission-mode",
      "plan",
    ];
    if (claude.maxTurns) {
      cliArgs.push("--max-turns", String(claude.maxTurns));
    }
    cliArgs.push(prompt);

    const result = await runCommand(this.command, cliArgs, args.repoRoot);
    const interrupted = result.signal === "SIGINT" || result.signal === "SIGTERM";
    if (interrupted) {
      return {
        status: "interrupted",
        exitCode: result.code,
        signal: result.signal,
        summary: "",
        error: "Claude ask command was interrupted.",
      };
    }
    if (result.code !== 0) {
      return {
        status: "failed",
        exitCode: result.code,
        signal: result.signal,
        summary: "",
        error: result.stderr || `Claude ask command exited with code ${result.code}.`,
      };
    }
    const summary = extractSummary(result.stdout);
    if (summary === undefined) {
      return {
        status: "failed",
        exitCode: result.code,
        signal: result.signal,
        summary: "",
        error: "Failed to parse Claude JSON output.",
      };
    }
    const sessionId = extractSessionId(result.stdout, result.stderr);
    return {
      status: "success",
      exitCode: result.code,
      signal: result.signal,
      sessionId,
      sessionIdAvailability: sessionId ? "captured" : "unavailable",
      sessionIdUnavailableReason: sessionId
        ? undefined
        : "Claude CLI JSON output did not expose a fork session id.",
      summary,
    };
  }
}

export function createAskBackend(id: BackendId, config: AskDefinition): AskBackend {
  if (id === "claude-cli") {
    return new ClaudeAskBackend(config.backend?.claude?.command ?? "claude");
  }
  throw new UserFacingError("cc-fork-matrix ask currently supports only the claude-cli backend.");
}
