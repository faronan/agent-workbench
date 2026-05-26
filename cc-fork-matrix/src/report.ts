import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RunMetadata, VariantResult } from "./types.ts";

function tableRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\n/g, "<br>")).join(" | ")} |`;
}

function variantSummary(variant: VariantResult): string {
  return [
    `# ${variant.name}`,
    "",
    `- Status: ${variant.status}`,
    `- Branch: ${variant.branch}`,
    `- Worktree: ${variant.worktree}`,
    variant.sessionId ? `- Session: ${variant.sessionId}` : "- Session: unavailable",
    variant.resumeCommand ? `- Resume: \`${variant.resumeCommand}\`` : "",
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

export async function writeVariantSummary(path: string, variant: VariantResult): Promise<void> {
  await writeFile(path, `${variantSummary(variant)}\n`);
}

export function renderReport(metadata: RunMetadata): string {
  const lines = [
    `# cc-fork-matrix report: ${metadata.name}`,
    "",
    `- Run ID: ${metadata.runId}`,
    `- Source: ${metadata.source.backend} ${metadata.source.session}`,
    `- Repo: ${metadata.repoRoot}`,
    `- Base: ${metadata.baseRef} @ ${metadata.baseHead}`,
    `- Dirty base: ${metadata.dirtyBase ? "yes" : "no"}`,
    "",
    tableRow(["Variant", "Status", "Branch", "Session", "Verification", "Changed files", "Resume"]),
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
        variant.sessionId ?? "",
        verification,
        String(variant.changedFiles.length),
        variant.resumeCommand ? `\`${variant.resumeCommand}\`` : "",
      ]),
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function regenerateReport(runDir: string): Promise<string> {
  const metadata = JSON.parse(
    await readFile(resolve(runDir, "metadata.json"), "utf8"),
  ) as RunMetadata;
  const report = renderReport(metadata);
  await writeFile(resolve(runDir, "report.md"), report);
  return report;
}
