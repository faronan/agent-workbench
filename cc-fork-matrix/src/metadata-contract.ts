import { UserFacingError } from "./errors.ts";
import type { RunMetadata } from "./types.ts";

const INVALID_METADATA_PREFIX = "legacy/invalid metadata; rerun cc-fork-matrix";

const BACKEND_IDS = ["claude-cli", "codex-cli", "claude-agent-sdk"];
const VARIANT_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "fork_failed",
  "verification_failed",
  "interrupted",
  "skipped",
];
const ASK_QUESTION_STATUSES = ["pending", "running", "succeeded", "failed", "interrupted"];
const OPEN_COMMAND_KINDS = ["resume-session", "open-worktree", "unavailable"];
const SESSION_ID_AVAILABILITIES = ["captured", "unavailable"];
const TERMINAL_LAUNCHERS = ["ghostty", "zellij"];
const LAUNCH_LAYOUTS = ["tabs", "splits"];
const LAUNCHER_STRATEGIES = ["ghostty-command-env", "zellij-new-tab-argv"];

export function invalidMetadata(message: string): never {
  throw new UserFacingError(`${INVALID_METADATA_PREFIX}: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(object, key);
}

function requireObject(value: unknown, context: string): Record<string, unknown> {
  if (!isObject(value)) {
    invalidMetadata(`${context} must be an object`);
  }
  return value;
}

function requireString(object: Record<string, unknown>, key: string, context: string): string {
  const value = object[key];
  if (typeof value !== "string") {
    invalidMetadata(`${context}.${key} must be a string`);
  }
  return value;
}

function requireBoolean(object: Record<string, unknown>, key: string, context: string): boolean {
  const value = object[key];
  if (typeof value !== "boolean") {
    invalidMetadata(`${context}.${key} must be a boolean`);
  }
  return value;
}

function requireNumber(object: Record<string, unknown>, key: string, context: string): number {
  const value = object[key];
  if (typeof value !== "number") {
    invalidMetadata(`${context}.${key} must be a number`);
  }
  return value;
}

function requireNumberOrNull(
  object: Record<string, unknown>,
  key: string,
  context: string,
): number | null {
  const value = object[key];
  if (typeof value !== "number" && value !== null) {
    invalidMetadata(`${context}.${key} must be a number or null`);
  }
  return value;
}

function requireStringOrNull(
  object: Record<string, unknown>,
  key: string,
  context: string,
): string | null {
  const value = object[key];
  if (typeof value !== "string" && value !== null) {
    invalidMetadata(`${context}.${key} must be a string or null`);
  }
  return value;
}

function requireArray(object: Record<string, unknown>, key: string, context: string): unknown[] {
  const value = object[key];
  if (!Array.isArray(value)) {
    invalidMetadata(`${context}.${key} must be an array`);
  }
  return value;
}

function assertVerificationCommand(value: unknown, context: string): void {
  const command = requireObject(value, context);
  requireString(command, "name", context);
  requireString(command, "command", context);
  if (hasOwn(command, "timeoutMs")) {
    requireNumber(command, "timeoutMs", context);
  }
}

function requireStringArray(object: Record<string, unknown>, key: string, context: string): void {
  const values = requireArray(object, key, context);
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string") {
      invalidMetadata(`${context}.${key}[${index}] must be a string`);
    }
  }
}

function requireOneOf(
  object: Record<string, unknown>,
  key: string,
  values: string[],
  context: string,
): string {
  const value = requireString(object, key, context);
  if (!values.includes(value)) {
    invalidMetadata(`${context}.${key} must be one of ${values.join(", ")}`);
  }
  return value;
}

function assertOptionalString(object: Record<string, unknown>, key: string, context: string): void {
  if (hasOwn(object, key) && typeof object[key] !== "string") {
    invalidMetadata(`${context}.${key} must be a string`);
  }
}

function assertOptionalNumberOrNull(
  object: Record<string, unknown>,
  key: string,
  context: string,
): void {
  if (hasOwn(object, key)) {
    requireNumberOrNull(object, key, context);
  }
}

function assertOptionalSessionIdAvailability(
  object: Record<string, unknown>,
  key: string,
  context: string,
): void {
  if (hasOwn(object, key)) {
    requireOneOf(object, key, SESSION_ID_AVAILABILITIES, context);
  }
}

function assertCommandInvocation(value: unknown, context: string): void {
  const invocation = requireObject(value, context);
  requireString(invocation, "cwd", context);
  requireStringArray(invocation, "argv", context);
  requireString(invocation, "shellCommand", context);
}

function assertLaunchers(value: unknown, context: string): void {
  const launchers = requireObject(value, context);
  assertCommandInvocation(launchers.ghostty, `${context}.ghostty`);
}

function assertVerificationResult(value: unknown, context: string): void {
  const result = requireObject(value, context);
  requireString(result, "name", context);
  requireString(result, "command", context);
  requireNumberOrNull(result, "code", context);
  requireStringOrNull(result, "signal", context);
  requireNumber(result, "durationMs", context);
}

function assertVariantOpenCommand(value: unknown, context: string): void {
  const openCommand = requireObject(value, context);
  const kind = requireOneOf(openCommand, "kind", OPEN_COMMAND_KINDS, context);
  requireOneOf(openCommand, "backend", BACKEND_IDS, context);

  if (kind === "unavailable") {
    const availability = requireOneOf(
      openCommand,
      "sessionIdAvailability",
      SESSION_ID_AVAILABILITIES,
      context,
    );
    if (availability !== "unavailable") {
      invalidMetadata(`${context}.sessionIdAvailability must be unavailable`);
    }
    requireString(openCommand, "sessionIdUnavailableReason", context);
    return;
  }

  assertCommandInvocation(openCommand.command, `${context}.command`);
  assertLaunchers(openCommand.launchers, `${context}.launchers`);

  if (kind === "resume-session") {
    requireString(openCommand, "sessionId", context);
    const availability = requireOneOf(
      openCommand,
      "sessionIdAvailability",
      SESSION_ID_AVAILABILITIES,
      context,
    );
    if (availability !== "captured") {
      invalidMetadata(`${context}.sessionIdAvailability must be captured`);
    }
    return;
  }

  assertOptionalSessionIdAvailability(openCommand, "sessionIdAvailability", context);
  assertOptionalString(openCommand, "sessionIdUnavailableReason", context);
}

function assertVariantResult(value: unknown, context: string): void {
  const variant = requireObject(value, context);
  if (hasOwn(variant, "resumeCommand")) {
    invalidMetadata(`${context}.resumeCommand is legacy metadata`);
  }
  requireString(variant, "name", context);
  requireString(variant, "slug", context);
  requireOneOf(variant, "status", VARIANT_STATUSES, context);
  requireString(variant, "branch", context);
  requireString(variant, "worktree", context);
  assertOptionalString(variant, "sessionId", context);
  assertOptionalString(variant, "startedAt", context);
  assertOptionalString(variant, "finishedAt", context);
  if (hasOwn(variant, "durationMs")) {
    requireNumber(variant, "durationMs", context);
  }
  assertOptionalNumberOrNull(variant, "backendExitCode", context);
  if (
    hasOwn(variant, "backendSignal") &&
    typeof variant.backendSignal !== "string" &&
    variant.backendSignal !== null
  ) {
    invalidMetadata(`${context}.backendSignal must be a string or null`);
  }
  assertOptionalSessionIdAvailability(variant, "sessionIdAvailability", context);
  assertOptionalString(variant, "sessionIdUnavailableReason", context);
  if (!hasOwn(variant, "openCommand")) {
    invalidMetadata(`${context}.openCommand is required`);
  }
  assertVariantOpenCommand(variant.openCommand, `${context}.openCommand`);
  const verification = requireArray(variant, "verification", context);
  for (const [index, entry] of verification.entries()) {
    assertVerificationResult(entry, `${context}.verification[${index}]`);
  }
  const verificationCommands = requireArray(variant, "verificationCommands", context);
  for (const [index, entry] of verificationCommands.entries()) {
    assertVerificationCommand(entry, `${context}.verificationCommands[${index}]`);
  }
  requireString(variant, "diffstat", context);
  requireStringArray(variant, "changedFiles", context);
  requireString(variant, "artifactDir", context);
  assertOptionalString(variant, "finalizedAt", context);
  assertOptionalString(variant, "error", context);
}

function assertOptionalBackendSignal(
  object: Record<string, unknown>,
  key: string,
  context: string,
): void {
  if (hasOwn(object, key) && typeof object[key] !== "string" && object[key] !== null) {
    invalidMetadata(`${context}.${key} must be a string or null`);
  }
}

function assertLaunchMetadata(value: unknown, context: string): void {
  const launch = requireObject(value, context);
  const mode = requireOneOf(launch, "mode", ["terminal"], context);
  if (mode !== "terminal") {
    invalidMetadata(`${context}.mode must be terminal`);
  }
  requireOneOf(launch, "terminal", TERMINAL_LAUNCHERS, context);
  requireOneOf(launch, "layout", LAUNCH_LAYOUTS, context);
  requireString(launch, "launchedAt", context);
  requireOneOf(launch, "launcherStrategy", LAUNCHER_STRATEGIES, context);
  const promptStoragePolicy = requireString(launch, "promptStoragePolicy", context);
  if (promptStoragePolicy !== "not-persisted") {
    invalidMetadata(`${context}.promptStoragePolicy must be not-persisted`);
  }
}

function assertAskQuestionResult(value: unknown, context: string): void {
  const question = requireObject(value, context);
  requireString(question, "name", context);
  requireString(question, "slug", context);
  requireOneOf(question, "status", ASK_QUESTION_STATUSES, context);
  requireString(question, "questionSha256", context);
  requireOneOf(question, "backend", BACKEND_IDS, context);
  requireString(question, "artifactDir", context);
  requireString(question, "answerSummaryPath", context);
  assertOptionalString(question, "sessionId", context);
  assertOptionalString(question, "startedAt", context);
  assertOptionalString(question, "finishedAt", context);
  if (hasOwn(question, "durationMs")) {
    requireNumber(question, "durationMs", context);
  }
  assertOptionalNumberOrNull(question, "backendExitCode", context);
  assertOptionalBackendSignal(question, "backendSignal", context);
  assertOptionalSessionIdAvailability(question, "sessionIdAvailability", context);
  assertOptionalString(question, "sessionIdUnavailableReason", context);
  assertOptionalString(question, "error", context);
}

function assertAskRunMetadata(value: unknown): void {
  const metadata = requireObject(value, "metadata");
  if (metadata.schemaVersion !== 1) {
    invalidMetadata("metadata.schemaVersion must be 1");
  }
  const kind = requireString(metadata, "kind", "metadata");
  if (kind !== "ask-run") {
    invalidMetadata("metadata.kind must be ask-run");
  }
  requireString(metadata, "toolVersion", "metadata");
  requireString(metadata, "runId", "metadata");
  requireString(metadata, "name", "metadata");
  requireString(metadata, "createdAt", "metadata");
  requireString(metadata, "updatedAt", "metadata");
  requireString(metadata, "repoRoot", "metadata");
  const source = requireObject(metadata.source, "metadata.source");
  requireOneOf(source, "backend", BACKEND_IDS, "metadata.source");
  requireString(source, "session", "metadata.source");
  if (hasOwn(source, "resolvedFrom")) {
    requireOneOf(source, "resolvedFrom", ["explicit", "env"], "metadata.source");
  }
  if (hasOwn(source, "env")) {
    requireOneOf(source, "env", ["CLAUDE_CODE_SESSION_ID"], "metadata.source");
  }
  requireString(metadata, "inputHash", "metadata");
  const answerPolicy = requireString(metadata, "answerPolicy", "metadata");
  if (answerPolicy !== "final-summary-only") {
    invalidMetadata("metadata.answerPolicy must be final-summary-only");
  }
  requireBoolean(metadata, "saveAnswers", "metadata");
  const questions = requireArray(metadata, "questions", "metadata");
  for (const [index, question] of questions.entries()) {
    assertAskQuestionResult(question, `metadata.questions[${index}]`);
  }
}

function assertMatrixRunMetadata(value: unknown): void {
  const metadata = requireObject(value, "metadata");
  if (metadata.schemaVersion !== 1) {
    invalidMetadata("metadata.schemaVersion must be 1");
  }
  if (hasOwn(metadata, "kind")) {
    const kind = requireString(metadata, "kind", "metadata");
    if (kind !== "matrix-run") {
      invalidMetadata("metadata.kind must be matrix-run or ask-run");
    }
  }
  requireString(metadata, "toolVersion", "metadata");
  requireString(metadata, "runId", "metadata");
  requireString(metadata, "name", "metadata");
  requireString(metadata, "createdAt", "metadata");
  requireString(metadata, "updatedAt", "metadata");
  requireString(metadata, "repoRoot", "metadata");
  requireString(metadata, "baseRef", "metadata");
  requireString(metadata, "baseHead", "metadata");
  const source = requireObject(metadata.source, "metadata.source");
  requireOneOf(source, "backend", BACKEND_IDS, "metadata.source");
  requireString(source, "session", "metadata.source");
  if (hasOwn(source, "resolvedFrom")) {
    requireOneOf(source, "resolvedFrom", ["explicit", "env"], "metadata.source");
  }
  if (hasOwn(source, "env")) {
    requireOneOf(source, "env", ["CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"], "metadata.source");
  }
  requireString(metadata, "matrixHash", "metadata");
  requireBoolean(metadata, "dirtyBase", "metadata");
  requireString(metadata, "dirtyBaseStatus", "metadata");
  if (hasOwn(metadata, "launch")) {
    assertLaunchMetadata(metadata.launch, "metadata.launch");
  }
  const variants = requireArray(metadata, "variants", "metadata");
  for (const [index, variant] of variants.entries()) {
    assertVariantResult(variant, `metadata.variants[${index}]`);
  }
}

export function assertRunMetadata(value: unknown): asserts value is RunMetadata {
  const metadata = requireObject(value, "metadata");
  if (metadata.kind === "ask-run") {
    assertAskRunMetadata(value);
    return;
  }
  assertMatrixRunMetadata(value);
}
