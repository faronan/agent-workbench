export type BackendId = "claude-cli" | "codex-cli" | "claude-agent-sdk";
export type MatrixFormat = "json" | "yaml" | "toml";
export type TerminalLauncher = "ghostty" | "zellij";
export type GhosttyLayout = "tabs" | "splits";
export type LaunchLayout = "tabs" | "splits";
export type VariantStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "fork_failed"
  | "verification_failed"
  | "interrupted"
  | "skipped";

export interface VerificationCommand {
  name: string;
  command: string;
  timeoutMs?: number;
}

export interface MatrixDefinition {
  version: 1;
  name: string;
  repo?: string;
  baseRef?: string;
  source?: {
    backend?: BackendId;
    session?: string;
  };
  run?: {
    concurrency?: number;
    dirtyBase?: "stop" | "allow";
    stateRoot?: string;
    failFast?: boolean;
  };
  backend?: {
    claude?: {
      command?: string;
      mode?: "print" | "background";
      permissionMode?: string;
      maxTurns?: number;
    };
    codex?: {
      command?: string;
    };
  };
  verification?: {
    commands?: VerificationCommand[];
  };
  variants: VariantDefinition[];
}

export interface VariantDefinition {
  name: string;
  prompt: string;
  branch?: string;
  worktree?: string;
  verification?: {
    commands?: VerificationCommand[];
  };
}

export interface CliOptions {
  command: string;
  matrixPath?: string;
  stdin?: boolean;
  format?: MatrixFormat;
  repo?: string;
  source?: string;
  backend?: BackendId;
  concurrency?: number;
  stateRoot?: string;
  runId?: string;
  allowDirtyBase?: boolean;
  failFast?: boolean;
  noVerify?: boolean;
  json?: boolean;
  dryRun?: boolean;
  launch?: boolean;
  variant?: string;
  terminal?: TerminalLauncher;
  layout?: LaunchLayout;
}

export interface ResolvedRun {
  matrix: MatrixDefinition;
  runId: string;
  repoRoot: string;
  baseRef: string;
  baseHead: string;
  stateRoot: string;
  runDir: string;
  sourceSession: string;
  sourceResolvedFrom: "explicit" | "env";
  sourceEnv?: "CLAUDE_CODE_SESSION_ID" | "CODEX_THREAD_ID";
  backend: BackendId;
  dirtyBase: boolean;
  dirtyBaseStatus: string;
  concurrency: number;
  failFast: boolean;
  verificationCommands: VerificationCommand[];
  variants: ResolvedVariant[];
}

export interface ResolvedVariant {
  name: string;
  slug: string;
  prompt: string;
  promptSha256: string;
  branch: string;
  worktree: string;
  artifactDir: string;
  summaryPath: string;
  diffPatchPath: string;
  verificationLogPath: string;
  metadataPath: string;
  verificationCommands: VerificationCommand[];
}

export interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface BackendRunResult {
  status: "success" | "failed" | "interrupted";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  sessionId?: string;
  sessionIdAvailability?: "captured" | "unavailable";
  sessionIdUnavailableReason?: string;
  summary: string;
  stdout: string;
  stderr: string;
}

export type SessionIdAvailability = "captured" | "unavailable";
export type OpenCommandKind = "resume-session" | "open-worktree" | "unavailable";

export interface CommandInvocation {
  cwd: string;
  argv: string[];
  shellCommand: string;
  displayShellCommand?: string;
  containsSensitiveArgs?: boolean;
}

export interface AgentLaunchTarget {
  name: string;
  slug: string;
  branch: string;
  worktree: string;
  promptSha256: string;
  command: CommandInvocation;
}

export type CodexLaunchTarget = AgentLaunchTarget;

export type VariantOpenCommand =
  | {
      kind: "resume-session";
      backend: BackendId;
      sessionId: string;
      sessionIdAvailability: "captured";
      command: CommandInvocation;
      launchers: {
        ghostty: CommandInvocation;
      };
    }
  | {
      kind: "open-worktree";
      backend: BackendId;
      sessionIdAvailability?: SessionIdAvailability;
      sessionIdUnavailableReason?: string;
      command: CommandInvocation;
      launchers: {
        ghostty: CommandInvocation;
      };
    }
  | {
      kind: "unavailable";
      backend: BackendId;
      sessionIdAvailability: "unavailable";
      sessionIdUnavailableReason: string;
    };

export interface VerificationResult {
  name: string;
  command: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

export interface VariantResult {
  name: string;
  slug: string;
  status: VariantStatus;
  branch: string;
  worktree: string;
  sessionId?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  backendExitCode?: number | null;
  backendSignal?: NodeJS.Signals | null;
  sessionIdAvailability?: SessionIdAvailability;
  sessionIdUnavailableReason?: string;
  openCommand: VariantOpenCommand;
  verification: VerificationResult[];
  diffstat: string;
  changedFiles: string[];
  artifactDir: string;
  error?: string;
}

export interface RunMetadata {
  schemaVersion: 1;
  toolVersion: string;
  runId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  repoRoot: string;
  baseRef: string;
  baseHead: string;
  source: {
    backend: BackendId;
    session: string;
    resolvedFrom?: "explicit" | "env";
    env?: "CLAUDE_CODE_SESSION_ID" | "CODEX_THREAD_ID";
  };
  matrixHash: string;
  dirtyBase: boolean;
  dirtyBaseStatus: string;
  variants: VariantResult[];
}
