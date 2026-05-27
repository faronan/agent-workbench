import { shellQuote } from "./shell.ts";
import type {
  BackendId,
  CommandInvocation,
  MatrixDefinition,
  ResolvedVariant,
  SessionIdAvailability,
  VariantOpenCommand,
} from "./types.ts";

function shellJoin(argv: string[]): string {
  return argv.map((arg) => shellQuote(arg)).join(" ");
}

function commandInvocation(cwd: string, argv: string[]): CommandInvocation {
  return {
    cwd,
    argv,
    shellCommand: `cd ${shellQuote(cwd)} && ${shellJoin(argv)}`,
  };
}

function ghosttyInvocation(cwd: string, argv: string[]): CommandInvocation {
  const ghosttyArgv = [
    "open",
    "-na",
    "Ghostty.app",
    "--args",
    `--working-directory=${cwd}`,
    "-e",
    ...argv,
  ];
  return {
    cwd,
    argv: ghosttyArgv,
    shellCommand: shellJoin(ghosttyArgv),
  };
}

function backendCommand(backend: BackendId, matrix: MatrixDefinition): string | undefined {
  if (backend === "claude-cli") {
    return matrix.backend?.claude?.command ?? "claude";
  }
  if (backend === "codex-cli") {
    return matrix.backend?.codex?.command ?? "codex";
  }
  return undefined;
}

function resumeArgv(backend: BackendId, command: string, sessionId: string): string[] | undefined {
  if (backend === "claude-cli") {
    return [command, "--resume", sessionId];
  }
  if (backend === "codex-cli") {
    return [command, "resume", sessionId];
  }
  return undefined;
}

export function buildVariantOpenCommand(args: {
  backend: BackendId;
  matrix: MatrixDefinition;
  variant: ResolvedVariant;
  sessionId?: string;
  sessionIdAvailability?: SessionIdAvailability;
  sessionIdUnavailableReason?: string;
}): VariantOpenCommand {
  const command = backendCommand(args.backend, args.matrix);
  if (!command) {
    return {
      kind: "unavailable",
      backend: args.backend,
      sessionIdAvailability: "unavailable",
      sessionIdUnavailableReason: `${args.backend} does not have a CLI open command contract.`,
    };
  }

  const argv = args.sessionId ? resumeArgv(args.backend, command, args.sessionId) : [command];
  if (!argv) {
    return {
      kind: "unavailable",
      backend: args.backend,
      sessionIdAvailability: "unavailable",
      sessionIdUnavailableReason: `${args.backend} does not have a CLI resume command contract.`,
    };
  }

  const invocation = commandInvocation(args.variant.worktree, argv);
  const launchers = {
    ghostty: ghosttyInvocation(args.variant.worktree, argv),
  };

  if (args.sessionId) {
    return {
      kind: "resume-session",
      backend: args.backend,
      sessionId: args.sessionId,
      sessionIdAvailability: "captured",
      command: invocation,
      launchers,
    };
  }

  return {
    kind: "open-worktree",
    backend: args.backend,
    sessionIdAvailability: args.sessionIdAvailability,
    sessionIdUnavailableReason: args.sessionIdUnavailableReason,
    command: invocation,
    launchers,
  };
}
