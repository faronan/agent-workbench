import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createBackend } from "./backend.ts";
import { changedFiles, createWorktree, diffPatch, diffStat } from "./git.ts";
import { initialMetadata, upsertVariant, writeMetadata } from "./metadata.ts";
import { redact } from "./redaction.ts";
import { renderReport, writeVariantSummary } from "./report.ts";
import { runCommand, shellQuote } from "./shell.ts";
import type { ResolvedRun, ResolvedVariant, RunMetadata, VariantResult } from "./types.ts";

const TOOL_VERSION = "0.1.0";

async function runVerification(variant: ResolvedVariant): Promise<{
  log: string;
  results: VariantResult["verification"];
}> {
  const logParts: string[] = [];
  const results: VariantResult["verification"] = [];
  for (const command of variant.verificationCommands) {
    const started = Date.now();
    logParts.push(`$ ${command.command}\n`);
    const result = await runCommand("sh", ["-lc", command.command], variant.worktree, {
      timeoutMs: command.timeoutMs,
    });
    const durationMs = Date.now() - started;
    logParts.push(result.stdout);
    logParts.push(result.stderr);
    logParts.push(`\n[exit=${result.code} durationMs=${durationMs}]\n\n`);
    results.push({
      name: command.name,
      command: command.command,
      code: result.code,
      signal: result.signal,
      durationMs,
    });
  }
  return { log: redact(logParts.join("")), results };
}

async function collectDiff(variant: ResolvedVariant): Promise<{
  diffstat: string;
  changedFiles: string[];
  patch: string;
}> {
  const [stat, files, patch] = await Promise.all([
    diffStat(variant.worktree),
    changedFiles(variant.worktree),
    diffPatch(variant.worktree),
  ]);
  return { diffstat: stat, changedFiles: files, patch };
}

function resumeCommand(variant: ResolvedVariant, sessionId?: string): string | undefined {
  if (!sessionId) {
    return undefined;
  }
  return `cd ${shellQuote(variant.worktree)} && claude --resume ${shellQuote(sessionId)}`;
}

async function runVariant(args: {
  run: ResolvedRun;
  variant: ResolvedVariant;
  metadata: RunMetadata;
  metadataPath: string;
  matrixHash: string;
}): Promise<VariantResult> {
  const { run, variant } = args;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  await mkdir(variant.artifactDir, { recursive: true });
  await createWorktree(run.repoRoot, variant.branch, variant.worktree, run.baseRef);
  const backend = createBackend(run.backend, run.matrix);
  const backendResult = await backend.startForkedSession({
    sourceSession: run.sourceSession,
    runId: run.runId,
    variant,
    matrix: run.matrix,
  });
  let verification: VariantResult["verification"] = [];
  let verificationLog = "";
  let status: VariantResult["status"] =
    backendResult.status === "success" ? "succeeded" : "fork_failed";
  if (backendResult.status === "success" && variant.verificationCommands.length > 0) {
    const verificationResult = await runVerification(variant);
    verification = verificationResult.results;
    verificationLog = verificationResult.log;
    if (verification.some((entry) => entry.code !== 0)) {
      status = "verification_failed";
    }
  }
  const diff = await collectDiff(variant);
  await writeFile(variant.diffPatchPath, diff.patch);
  await writeFile(variant.verificationLogPath, verificationLog);
  const result: VariantResult = {
    name: variant.name,
    slug: variant.slug,
    status,
    branch: variant.branch,
    worktree: variant.worktree,
    sessionId: backendResult.sessionId,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    backendExitCode: backendResult.exitCode,
    backendSignal: backendResult.signal,
    verification,
    diffstat: diff.diffstat,
    changedFiles: diff.changedFiles,
    artifactDir: variant.artifactDir,
    resumeCommand: resumeCommand(variant, backendResult.sessionId),
    error: backendResult.status === "failed" ? redact(backendResult.stderr).trim() : undefined,
  };
  await writeFile(variant.metadataPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeVariantSummary(variant.summaryPath, result);
  upsertVariant(args.metadata, result);
  await writeMetadata(args.metadataPath, args.metadata);
  return result;
}

export async function runMatrix(resolved: ResolvedRun, matrixHash: string): Promise<RunMetadata> {
  const backend = createBackend(resolved.backend, resolved.matrix);
  await backend.checkAvailability();
  const metadataPath = resolve(resolved.runDir, "metadata.json");
  const metadata = initialMetadata({
    toolVersion: TOOL_VERSION,
    runId: resolved.runId,
    name: resolved.matrix.name,
    repoRoot: resolved.repoRoot,
    baseRef: resolved.baseRef,
    baseHead: resolved.baseHead,
    backend: resolved.backend,
    sourceSession: resolved.sourceSession,
    matrixHash,
    dirtyBase: resolved.dirtyBase,
    dirtyBaseStatus: resolved.dirtyBaseStatus,
  });
  await writeMetadata(metadataPath, metadata);

  let nextIndex = 0;
  let shouldStop = false;
  async function worker(): Promise<void> {
    while (!shouldStop && nextIndex < resolved.variants.length) {
      const variant = resolved.variants[nextIndex];
      nextIndex += 1;
      try {
        const result = await runVariant({
          run: resolved,
          variant,
          metadata,
          metadataPath,
          matrixHash,
        });
        if (resolved.failFast && result.status !== "succeeded") {
          shouldStop = true;
        }
      } catch (error) {
        const result: VariantResult = {
          name: variant.name,
          slug: variant.slug,
          status: "fork_failed",
          branch: variant.branch,
          worktree: variant.worktree,
          verification: [],
          diffstat: "",
          changedFiles: [],
          artifactDir: variant.artifactDir,
          error: redact((error as Error).message),
        };
        await mkdir(variant.artifactDir, { recursive: true });
        await writeFile(variant.metadataPath, `${JSON.stringify(result, null, 2)}\n`);
        await writeVariantSummary(variant.summaryPath, result);
        upsertVariant(metadata, result);
        await writeMetadata(metadataPath, metadata);
        if (resolved.failFast) {
          shouldStop = true;
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, resolved.concurrency) }, async () => worker()),
  );
  await writeFile(resolve(resolved.runDir, "report.md"), renderReport(metadata));
  return metadata;
}

export function renderDryRun(resolved: ResolvedRun): string {
  const lines = [
    `Run ID: ${resolved.runId}`,
    `Repo: ${resolved.repoRoot}`,
    `Base: ${resolved.baseRef} @ ${resolved.baseHead}`,
    `State root: ${resolved.stateRoot}`,
    `Run dir: ${resolved.runDir}`,
    `Source: ${resolved.backend} ${resolved.sourceSession}`,
    `Dirty base: ${resolved.dirtyBase ? "yes" : "no"}`,
    `Concurrency: ${resolved.concurrency}`,
    "",
    "Variants:",
  ];
  for (const variant of resolved.variants) {
    lines.push(`- ${variant.name}`);
    lines.push(`  branch: ${variant.branch}`);
    lines.push(`  worktree: ${variant.worktree}`);
    lines.push(`  promptSha256: ${variant.promptSha256}`);
    lines.push(
      `  verification: ${variant.verificationCommands.map((cmd) => cmd.name).join(", ") || "none"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function dryRunJson(resolved: ResolvedRun): unknown {
  return {
    runId: resolved.runId,
    repoRoot: resolved.repoRoot,
    baseRef: resolved.baseRef,
    baseHead: resolved.baseHead,
    stateRoot: resolved.stateRoot,
    runDir: resolved.runDir,
    source: {
      backend: resolved.backend,
      session: resolved.sourceSession,
    },
    dirtyBase: resolved.dirtyBase,
    concurrency: resolved.concurrency,
    variants: resolved.variants.map((variant) => ({
      name: variant.name,
      slug: variant.slug,
      branch: variant.branch,
      worktree: variant.worktree,
      artifactDir: variant.artifactDir,
      promptSha256: variant.promptSha256,
      verificationCommands: variant.verificationCommands,
    })),
  };
}
