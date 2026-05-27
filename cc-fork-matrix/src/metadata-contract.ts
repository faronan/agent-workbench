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
const OPEN_COMMAND_KINDS = ["resume-session", "open-worktree", "unavailable"];
const SESSION_ID_AVAILABILITIES = ["captured", "unavailable"];

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

function requireArray(object: Record<string, unknown>, key: string, context: string): unknown[] {
  const value = object[key];
  if (!Array.isArray(value)) {
    invalidMetadata(`${context}.${key} must be an array`);
  }
  return value;
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
  if (hasOwn(object, key) && typeof object[key] !== "number" && object[key] !== null) {
    invalidMetadata(`${context}.${key} must be a number or null`);
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
  assertOptionalNumberOrNull(result, "code", context);
  if (hasOwn(result, "signal") && typeof result.signal !== "string" && result.signal !== null) {
    invalidMetadata(`${context}.signal must be a string or null`);
  }
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
  requireString(variant, "diffstat", context);
  requireStringArray(variant, "changedFiles", context);
  requireString(variant, "artifactDir", context);
  assertOptionalString(variant, "error", context);
}

export function assertRunMetadata(value: unknown): asserts value is RunMetadata {
  const metadata = requireObject(value, "metadata");
  if (metadata.schemaVersion !== 1) {
    invalidMetadata("metadata.schemaVersion must be 1");
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
  const variants = requireArray(metadata, "variants", "metadata");
  for (const [index, variant] of variants.entries()) {
    assertVariantResult(variant, `metadata.variants[${index}]`);
  }
}
