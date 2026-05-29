import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readMetadata } from "./metadata.ts";
import type { AskQuestionResult, RunMetadata, VariantResult } from "./types.ts";
import { isAskRunMetadata } from "./types.ts";

function tableRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\n/g, "<br>")).join(" | ")} |`;
}

function sessionText(variant: VariantResult): string {
  if (variant.sessionId) {
    return variant.sessionId;
  }
  if (variant.sessionIdAvailability === "unavailable") {
    return variant.sessionIdUnavailableReason
      ? `unavailable (${variant.sessionIdUnavailableReason})`
      : "unavailable";
  }
  return "unavailable";
}

function openText(variant: VariantResult): string {
  if (variant.openCommand.kind === "unavailable") {
    return `unavailable (${variant.openCommand.sessionIdUnavailableReason})`;
  }
  return variant.openCommand.command.shellCommand;
}

function variantSummary(variant: VariantResult): string {
  return [
    `# ${variant.name}`,
    "",
    `- Status: ${variant.status}`,
    `- Branch: ${variant.branch}`,
    `- Worktree: ${variant.worktree}`,
    `- Session: ${sessionText(variant)}`,
    `- Open: \`${openText(variant)}\``,
    "",
    "## Verification",
    "",
    ...variant.verification.map(
      (entry) => `- ${entry.name}: exit ${entry.code ?? "signal"} (${entry.durationMs}ms)`,
    ),
    "",
    "## Changed Files",
    "",
    ...(variant.changedFiles.length > 0
      ? variant.changedFiles.map((file) => `- ${file}`)
      : ["None"]),
    "",
    "## Diffstat",
    "",
    variant.diffstat || "No tracked diff.",
    "",
    variant.error ? `## Error\n\n${variant.error}\n` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function askSessionText(question: AskQuestionResult): string {
  if (question.sessionId) {
    return question.sessionId;
  }
  if (question.sessionIdAvailability === "unavailable") {
    return question.sessionIdUnavailableReason
      ? `unavailable (${question.sessionIdUnavailableReason})`
      : "unavailable";
  }
  return "unavailable";
}

function askQuestionSummary(question: AskQuestionResult, answerSummary?: string): string {
  return [
    `# ${question.name}`,
    "",
    `- Status: ${question.status}`,
    `- Question hash: ${question.questionSha256}`,
    `- Session: ${askSessionText(question)}`,
    "",
    "## Answer Summary",
    "",
    answerSummary ?? "Not saved.",
    "",
    question.error ? `## Error\n\n${question.error}\n` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function writeVariantSummary(path: string, variant: VariantResult): Promise<void> {
  await writeFile(path, `${variantSummary(variant)}\n`);
}

export async function writeAskQuestionSummary(
  path: string,
  question: AskQuestionResult,
  answerSummary?: string,
): Promise<void> {
  await writeFile(path, `${askQuestionSummary(question, answerSummary)}\n`);
}

function renderAskReport(metadata: RunMetadata): string {
  if (!isAskRunMetadata(metadata)) {
    throw new Error("renderAskReport requires ask metadata");
  }
  const lines = [
    `# cc-fork-matrix ask report: ${metadata.name}`,
    "",
    `- Run ID: ${metadata.runId}`,
    `- Source: ${metadata.source.backend} ${metadata.source.session}`,
    `- Repo: ${metadata.repoRoot}`,
    `- Answer policy: ${metadata.answerPolicy}`,
    `- Save answers: ${metadata.saveAnswers ? "yes" : "no"}`,
    "",
    tableRow(["Question", "Status", "Session", "Summary", "Question hash", "Error"]),
    tableRow(["---", "---", "---", "---", "---", "---"]),
  ];
  for (const question of metadata.questions) {
    lines.push(
      tableRow([
        question.name,
        question.status,
        askSessionText(question),
        question.answerSummaryPath,
        question.questionSha256,
        question.error ?? "",
      ]),
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderReport(metadata: RunMetadata): string {
  if (isAskRunMetadata(metadata)) {
    return renderAskReport(metadata);
  }
  const lines = [
    `# cc-fork-matrix report: ${metadata.name}`,
    "",
    `- Run ID: ${metadata.runId}`,
    `- Source: ${metadata.source.backend} ${metadata.source.session}`,
    `- Repo: ${metadata.repoRoot}`,
    `- Base: ${metadata.baseRef} @ ${metadata.baseHead}`,
    `- Dirty base: ${metadata.dirtyBase ? "yes" : "no"}`,
    "",
    tableRow(["Variant", "Status", "Branch", "Session", "Verification", "Changed files", "Open"]),
    tableRow(["---", "---", "---", "---", "---", "---", "---"]),
  ];
  for (const variant of metadata.variants) {
    const verification =
      variant.verification.length === 0
        ? "not run"
        : variant.verification
            .map((entry) => `${entry.name}:${entry.code === 0 ? "pass" : `fail(${entry.code})`}`)
            .join("<br>");
    lines.push(
      tableRow([
        variant.name,
        variant.status,
        variant.branch,
        sessionText(variant),
        verification,
        String(variant.changedFiles.length),
        `\`${openText(variant)}\``,
      ]),
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function regenerateReport(runDir: string): Promise<string> {
  const metadata = await readMetadata(resolve(runDir, "metadata.json"));
  const report = renderReport(metadata);
  await writeFile(resolve(runDir, "report.md"), report);
  return report;
}
