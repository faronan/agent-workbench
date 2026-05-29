import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { changedFiles, diffPatch, diffStat } from "./git.ts";
import { redact } from "./redaction.ts";
import { writeVariantSummary } from "./report.ts";
import { runCommand } from "./shell.ts";
import type { VariantResult, VerificationCommand } from "./types.ts";

export interface VariantArtifactPaths {
  artifactDir: string;
  summaryPath: string;
  diffPatchPath: string;
  verificationLogPath: string;
  metadataPath: string;
}

export function artifactPathsForVariant(variant: {
  artifactDir: string;
  slug: string;
}): VariantArtifactPaths {
  return {
    artifactDir: variant.artifactDir,
    summaryPath: resolve(variant.artifactDir, "summary.md"),
    diffPatchPath: resolve(variant.artifactDir, "diff.patch"),
    verificationLogPath: resolve(variant.artifactDir, "verification.log"),
    metadataPath: resolve(variant.artifactDir, "metadata.json"),
  };
}

export async function runVerification(args: {
  worktree: string;
  commands: VerificationCommand[];
}): Promise<{
  log: string;
  results: VariantResult["verification"];
}> {
  const logParts: string[] = [];
  const results: VariantResult["verification"] = [];
  for (const command of args.commands) {
    const started = Date.now();
    logParts.push(`$ ${command.command}\n`);
    const result = await runCommand("sh", ["-lc", command.command], args.worktree, {
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

export async function collectDiff(worktree: string): Promise<{
  diffstat: string;
  changedFiles: string[];
  patch: string;
}> {
  const [stat, files, patch] = await Promise.all([
    diffStat(worktree),
    changedFiles(worktree),
    diffPatch(worktree),
  ]);
  return { diffstat: stat, changedFiles: files, patch };
}

export async function writeVariantArtifacts(args: {
  paths: VariantArtifactPaths;
  result: VariantResult;
  diffPatchText?: string;
  verificationLog?: string;
}): Promise<void> {
  await mkdir(args.paths.artifactDir, { recursive: true });
  if (args.diffPatchText !== undefined) {
    await writeFile(args.paths.diffPatchPath, args.diffPatchText);
  }
  if (args.verificationLog !== undefined) {
    await writeFile(args.paths.verificationLogPath, args.verificationLog);
  }
  await writeFile(args.paths.metadataPath, `${JSON.stringify(args.result, null, 2)}\n`);
  await writeVariantSummary(args.paths.summaryPath, args.result);
}
