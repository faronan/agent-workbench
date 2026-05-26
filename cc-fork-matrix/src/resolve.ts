import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./crypto.ts";
import { UserFacingError } from "./errors.ts";
import {
  branchExists,
  currentHead,
  dirtyStatus,
  repoRoot as findRepoRoot,
  pathExists,
} from "./git.ts";
import { slugify, timestampRunId } from "./slug.ts";
import type { CliOptions, MatrixDefinition, ResolvedRun, VerificationCommand } from "./types.ts";
import { assertSafeVerificationCommands } from "./validation.ts";

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => values[key] ?? "");
}

function mergeCommands(
  globalCommands: VerificationCommand[],
  localCommands?: VerificationCommand[],
): VerificationCommand[] {
  return localCommands && localCommands.length > 0 ? localCommands : globalCommands;
}

export async function resolveRun(
  matrix: MatrixDefinition,
  matrixHash: string,
  options: CliOptions,
  mode: "dry-run" | "run",
): Promise<ResolvedRun> {
  const runId = options.runId ?? timestampRunId();
  const repoCandidate = options.repo ?? matrix.repo ?? process.cwd();
  const repoRoot = await findRepoRoot(resolve(repoCandidate));
  const baseRef = matrix.baseRef ?? "HEAD";
  const baseHead = await currentHead(repoRoot);
  const dirtyBaseStatus = await dirtyStatus(repoRoot);
  const dirtyBase = dirtyBaseStatus.length > 0;
  const dirtyPolicy =
    options.allowDirtyBase || matrix.run?.dirtyBase === "allow" ? "allow" : "stop";
  if (dirtyBase && dirtyPolicy === "stop") {
    throw new UserFacingError(
      "Base repository has uncommitted changes. Re-run with --allow-dirty-base to continue without copying them.",
    );
  }

  const backend = options.backend ?? matrix.source?.backend ?? "claude-cli";
  const sourceRaw = options.source ?? matrix.source?.session ?? "current";
  let sourceSession: string;
  let sourceResolvedFrom: ResolvedRun["sourceResolvedFrom"];
  let sourceEnv: ResolvedRun["sourceEnv"];
  if (sourceRaw === "current") {
    if (backend === "codex-cli") {
      sourceSession = process.env.CODEX_THREAD_ID ?? "";
      sourceResolvedFrom = "env";
      sourceEnv = "CODEX_THREAD_ID";
      if (!sourceSession) {
        throw new UserFacingError(
          "source is current for codex-cli, but CODEX_THREAD_ID is not set. Pass --source <session-id>.",
        );
      }
    } else {
      sourceSession = process.env.CLAUDE_CODE_SESSION_ID ?? "";
      sourceResolvedFrom = "env";
      sourceEnv = "CLAUDE_CODE_SESSION_ID";
      if (!sourceSession) {
        throw new UserFacingError(
          "source is current, but CLAUDE_CODE_SESSION_ID is not set. Pass --source <session-id-or-name>.",
        );
      }
    }
  } else {
    sourceSession = sourceRaw;
    sourceResolvedFrom = "explicit";
  }

  const matrixSlug = slugify(matrix.name);
  const stateRoot = resolve(
    repoRoot,
    options.stateRoot ?? matrix.run?.stateRoot ?? `../.cc-fork-matrix/${matrixSlug}`,
  );
  const runDir = resolve(stateRoot, "runs", runId);
  const concurrency = options.concurrency ?? matrix.run?.concurrency ?? 1;
  if (backend === "codex-cli" && concurrency > 1) {
    throw new UserFacingError(
      "codex-cli backend launches interactive fork sessions and requires concurrency: 1.",
    );
  }
  const failFast = options.failFast ?? matrix.run?.failFast ?? false;
  const verificationCommands = options.noVerify ? [] : (matrix.verification?.commands ?? []);
  assertSafeVerificationCommands(verificationCommands);

  const variants = [];
  for (const variant of matrix.variants) {
    const slug = slugify(variant.name);
    const values = { runId, name: matrixSlug, variant: slug };
    const branch = interpolate(
      variant.branch ?? `cc-fork-matrix/${matrixSlug}/${runId}/${slug}`,
      values,
    );
    const worktree = resolve(
      repoRoot,
      interpolate(
        variant.worktree ?? `../.cc-fork-matrix/${matrixSlug}/worktrees/${runId}/${slug}`,
        values,
      ),
    );
    if (await branchExists(repoRoot, branch)) {
      throw new UserFacingError(`Branch already exists: ${branch}`);
    }
    if (pathExists(worktree)) {
      throw new UserFacingError(`Worktree path already exists: ${worktree}`);
    }
    const artifactDir = resolve(runDir, slug);
    const variantCommands = options.noVerify
      ? []
      : mergeCommands(verificationCommands, variant.verification?.commands);
    assertSafeVerificationCommands(variantCommands);
    variants.push({
      name: variant.name,
      slug,
      prompt: variant.prompt,
      promptSha256: sha256(variant.prompt),
      branch,
      worktree,
      artifactDir,
      summaryPath: resolve(artifactDir, "summary.md"),
      diffPatchPath: resolve(artifactDir, "diff.patch"),
      verificationLogPath: resolve(artifactDir, "verification.log"),
      metadataPath: resolve(artifactDir, "metadata.json"),
      verificationCommands: variantCommands,
    });
  }

  if (mode === "run") {
    await mkdir(runDir, { recursive: true });
  }

  void matrixHash;
  return {
    matrix,
    runId,
    repoRoot,
    baseRef,
    baseHead,
    stateRoot,
    runDir,
    sourceSession,
    sourceResolvedFrom,
    sourceEnv,
    backend,
    dirtyBase,
    dirtyBaseStatus,
    concurrency,
    failFast,
    verificationCommands,
    variants,
  };
}
