import { resolve } from "node:path";
import { readMetadata } from "./metadata.ts";
import type { AskQuestionStatus, RunMetadata, VariantStatus } from "./types.ts";
import { isAskRunMetadata } from "./types.ts";

export interface StatusOptions {
  json?: boolean;
}

function countValues<T extends string>(values: T[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function renderCounts<T extends string>(counts: Partial<Record<T, number>>): string {
  return (
    Object.entries(counts)
      .map(([status, count]) => `${status}=${count}`)
      .join(", ") || "none"
  );
}

function renderMatrixStatus(metadata: RunMetadata, runDir: string): string {
  if (isAskRunMetadata(metadata)) {
    throw new Error("renderMatrixStatus requires matrix metadata");
  }
  const counts = countValues<VariantStatus>(metadata.variants.map((variant) => variant.status));
  const runningCount = metadata.variants.filter((variant) => variant.status === "running").length;
  const lines = [
    `Run: ${metadata.name} (run)`,
    "Kind: matrix-run",
    `Run ID: ${metadata.runId}`,
    `Run dir: ${runDir}`,
    `Repo: ${metadata.repoRoot}`,
    `Source: ${metadata.source.backend} ${metadata.source.session}`,
    `Status counts: ${renderCounts(counts)}`,
    "",
    "Lifecycle:",
    "- open: supported",
    "- status: supported",
    "- report: supported",
    `- finalize: supported${runningCount > 0 ? ` (${runningCount} running)` : " (no running variants)"}`,
    "- cleanup: supported; run cleanup dry-run JSON before removal",
    "",
    "Variants:",
  ];
  for (const variant of metadata.variants) {
    lines.push(
      `- ${variant.name} [${variant.slug}]: ${variant.status} changes=${variant.changedFiles.length}`,
    );
    lines.push(`  branch: ${variant.branch}`);
    lines.push(`  worktree: ${variant.worktree}`);
  }
  lines.push(
    "",
    "Next:",
    `- cc-fork-matrix report ${runDir}`,
    runningCount > 0
      ? `- cc-fork-matrix finalize ${runDir} --json`
      : `- cc-fork-matrix cleanup ${runDir} --dry-run --json`,
  );
  return `${lines.join("\n")}\n`;
}

function renderAskStatus(metadata: RunMetadata, runDir: string): string {
  if (!isAskRunMetadata(metadata)) {
    throw new Error("renderAskStatus requires ask metadata");
  }
  const counts = countValues<AskQuestionStatus>(
    metadata.questions.map((question) => question.status),
  );
  const lines = [
    `Run: ${metadata.name} (ask-run)`,
    "Kind: ask-run",
    `Run ID: ${metadata.runId}`,
    `Run dir: ${runDir}`,
    `Repo: ${metadata.repoRoot}`,
    `Source: ${metadata.source.backend} ${metadata.source.session}`,
    `Status counts: ${renderCounts(counts)}`,
    `Answer policy: ${metadata.answerPolicy}`,
    "",
    "Lifecycle:",
    "- status: supported",
    "- report: supported",
    "- list --json: supported",
    "- open/finalize/cleanup: not supported for ask runs because they have no worktrees",
    "",
    "Questions:",
  ];
  for (const question of metadata.questions) {
    lines.push(`- ${question.name} [${question.slug}]: ${question.status}`);
    lines.push(`  questionSha256: ${question.questionSha256}`);
    lines.push(`  summary: ${question.answerSummaryPath}`);
  }
  lines.push("", "Next:", `- cc-fork-matrix report ${runDir}`);
  return `${lines.join("\n")}\n`;
}

export async function printStatus(runDir: string, options: StatusOptions = {}): Promise<string> {
  const resolvedRunDir = resolve(runDir);
  const metadata = await readMetadata(resolve(resolvedRunDir, "metadata.json"));
  if (options.json) {
    return `${JSON.stringify(metadata, null, 2)}\n`;
  }
  return isAskRunMetadata(metadata)
    ? renderAskStatus(metadata, resolvedRunDir)
    : renderMatrixStatus(metadata, resolvedRunDir);
}
