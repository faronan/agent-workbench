import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./crypto.ts";
import { UserFacingError } from "./errors.ts";
import { repoRoot as findRepoRoot } from "./git.ts";
import { slugify, timestampRunId } from "./slug.ts";
import type { AskDefinition, CliOptions, ResolvedAskRun } from "./types.ts";

export async function resolveAskRun(
  config: AskDefinition,
  inputHash: string,
  options: CliOptions,
  mode: "dry-run" | "run",
): Promise<ResolvedAskRun> {
  const backend = options.backend ?? config.source?.backend ?? "claude-cli";
  if (backend !== "claude-cli") {
    throw new UserFacingError("cc-fork-matrix ask currently supports only the claude-cli backend.");
  }

  const runId = options.runId ?? timestampRunId();
  const repoCandidate = options.repo ?? config.repo ?? process.cwd();
  const repoRoot = await findRepoRoot(resolve(repoCandidate));
  const sourceRaw = options.source ?? config.source?.session ?? "current";
  let sourceSession: string;
  let sourceResolvedFrom: ResolvedAskRun["sourceResolvedFrom"];
  let sourceEnv: ResolvedAskRun["sourceEnv"];
  if (sourceRaw === "current") {
    sourceSession = process.env.CLAUDE_CODE_SESSION_ID ?? "";
    sourceResolvedFrom = "env";
    sourceEnv = "CLAUDE_CODE_SESSION_ID";
    if (!sourceSession) {
      throw new UserFacingError(
        [
          "source is current for backend claude-cli, but CLAUDE_CODE_SESSION_ID is not set.",
          "Run inside a Claude Code session or pass an explicit source with --source <session-id-or-name>.",
          "Required env for current Claude Code source: CLAUDE_CODE_SESSION_ID.",
        ].join("\n"),
      );
    }
  } else {
    sourceSession = sourceRaw;
    sourceResolvedFrom = "explicit";
  }

  const configSlug = slugify(config.name);
  const stateRoot = resolve(
    repoRoot,
    options.stateRoot ?? config.ask?.stateRoot ?? `../.cc-fork-matrix/${configSlug}`,
  );
  const runDir = resolve(stateRoot, "runs", runId);
  const concurrency = options.concurrency ?? config.ask?.concurrency ?? 3;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new UserFacingError("--concurrency must be a positive integer.");
  }
  const saveAnswers = config.ask?.saveAnswers ?? true;
  const answerPolicy = config.ask?.answerPolicy ?? "final-summary-only";

  const seen = new Set<string>();
  const questions = config.questions.map((question) => {
    const slug = slugify(question.name);
    if (!slug) {
      throw new UserFacingError(`Question name cannot be slugified: ${question.name}`);
    }
    if (seen.has(slug)) {
      throw new UserFacingError(`Duplicate question slug: ${slug}`);
    }
    seen.add(slug);
    const artifactDir = resolve(runDir, slug);
    return {
      name: question.name,
      slug,
      question: question.question,
      questionSha256: sha256(question.question),
      artifactDir,
      answerSummaryPath: resolve(artifactDir, "summary.md"),
    };
  });

  if (mode === "run") {
    await mkdir(runDir, { recursive: true });
  }

  return {
    config,
    inputHash,
    runId,
    repoRoot,
    stateRoot,
    runDir,
    sourceSession,
    sourceResolvedFrom,
    sourceEnv,
    backend,
    concurrency,
    saveAnswers,
    answerPolicy,
    questions,
  };
}
