import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathExists } from "./git.ts";
import { readMetadata, upsertVariant, writeMetadata } from "./metadata.ts";
import { renderReport } from "./report.ts";
import type { RunMetadata, VariantResult } from "./types.ts";
import {
  artifactPathsForVariant,
  collectDiff,
  runVerification,
  writeVariantArtifacts,
} from "./variant-artifacts.ts";

export interface FinalizeVariantResult {
  name: string;
  slug: string;
  previousStatus: VariantResult["status"];
  status: VariantResult["status"];
  changedFiles: string[];
  verification: VariantResult["verification"];
  error?: string;
}

export interface FinalizeResult {
  runDir: string;
  finalizedAt: string;
  variants: FinalizeVariantResult[];
}

function metadataPath(runDir: string): string {
  return resolve(runDir, "metadata.json");
}

async function finalizeVariant(variant: VariantResult): Promise<{
  result: VariantResult;
  patch?: string;
  verificationLog?: string;
}> {
  const finalizedAt = new Date().toISOString();
  if (!pathExists(variant.worktree)) {
    return {
      result: {
        ...variant,
        status: "skipped",
        finishedAt: finalizedAt,
        finalizedAt,
        error: "Missing worktree; skipped finalize.",
      },
      patch: "",
      verificationLog: "",
    };
  }

  const commands = variant.verificationCommands;
  const verificationResult =
    commands.length > 0
      ? await runVerification({ worktree: variant.worktree, commands })
      : { log: "", results: [] };
  const diff = await collectDiff(variant.worktree);
  const hasVerificationFailure = verificationResult.results.some((entry) => entry.code !== 0);
  const status: VariantResult["status"] =
    commands.length > 0
      ? hasVerificationFailure
        ? "verification_failed"
        : "succeeded"
      : diff.changedFiles.length > 0
        ? "succeeded"
        : "skipped";

  return {
    result: {
      ...variant,
      status,
      finishedAt: finalizedAt,
      finalizedAt,
      verification: verificationResult.results,
      diffstat: diff.diffstat,
      changedFiles: diff.changedFiles,
      error: status === "verification_failed" ? "Verification failed during finalize." : undefined,
    },
    patch: diff.patch,
    verificationLog: verificationResult.log,
  };
}

function summarizeVariant(previous: VariantResult, next: VariantResult): FinalizeVariantResult {
  return {
    name: next.name,
    slug: next.slug,
    previousStatus: previous.status,
    status: next.status,
    changedFiles: next.changedFiles,
    verification: next.verification,
    error: next.error,
  };
}

export async function finalizeRun(runDir: string): Promise<FinalizeResult> {
  const resolvedRunDir = resolve(runDir);
  const path = metadataPath(resolvedRunDir);
  const metadata: RunMetadata = await readMetadata(path);
  const finalizedAt = new Date().toISOString();
  const variants: FinalizeVariantResult[] = [];

  for (const variant of metadata.variants) {
    if (variant.status !== "running") {
      variants.push(summarizeVariant(variant, variant));
      continue;
    }
    const finalized = await finalizeVariant(variant);
    await writeVariantArtifacts({
      paths: artifactPathsForVariant(finalized.result),
      result: finalized.result,
      diffPatchText: finalized.patch,
      verificationLog: finalized.verificationLog,
    });
    upsertVariant(metadata, finalized.result);
    variants.push(summarizeVariant(variant, finalized.result));
  }

  await writeMetadata(path, metadata);
  await writeFile(resolve(resolvedRunDir, "report.md"), renderReport(metadata));
  return { runDir: resolvedRunDir, finalizedAt, variants };
}
