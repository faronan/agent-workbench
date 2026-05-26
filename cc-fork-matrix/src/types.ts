export type BackendId = "claude-cli" | "codex-cli" | "claude-agent-sdk";
export type MatrixFormat = "json" | "yaml" | "toml";
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
  variant?: string;
  printCommand?: boolean;
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
  summary: string;
  stdout: string;
  stderr: string;
}

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
  verification: VerificationResult[];
  diffstat: string;
  changedFiles: string[];
  artifactDir: string;
  resumeCommand?: string;
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
  };
  matrixHash: string;
  dirtyBase: boolean;
  dirtyBaseStatus: string;
  variants: VariantResult[];
}
