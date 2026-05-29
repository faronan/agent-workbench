import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAskBackend } from "./ask-backend.ts";
import { redact } from "./redaction.ts";
import { renderReport, writeAskQuestionSummary } from "./report.ts";
import { writeLatestPointers } from "./run-discovery.ts";
import type {
  AskQuestionResult,
  AskRunMetadata,
  ResolvedAskQuestion,
  ResolvedAskRun,
} from "./types.ts";

const TOOL_VERSION = "0.1.0";

function scrubQuestion(text: string, question: string): string {
  const redacted = redact(text);
  return redacted
    .replaceAll(question, "[REDACTED_QUESTION]")
    .replaceAll(redact(question), "[REDACTED_QUESTION]")
    .slice(0, 4000);
}

function initialAskMetadata(resolved: ResolvedAskRun, inputHash: string): AskRunMetadata {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    kind: "ask-run",
    toolVersion: TOOL_VERSION,
    runId: resolved.runId,
    name: resolved.config.name,
    createdAt: now,
    updatedAt: now,
    repoRoot: resolved.repoRoot,
    source: {
      backend: resolved.backend,
      session: resolved.sourceSession,
      resolvedFrom: resolved.sourceResolvedFrom,
      env: resolved.sourceEnv,
    },
    inputHash,
    answerPolicy: resolved.answerPolicy,
    saveAnswers: resolved.saveAnswers,
    questions: [],
  };
}

function upsertQuestion(metadata: AskRunMetadata, question: AskQuestionResult): void {
  const index = metadata.questions.findIndex((entry) => entry.slug === question.slug);
  if (index >= 0) {
    metadata.questions[index] = question;
  } else {
    metadata.questions.push(question);
  }
}

async function writeAskMetadata(path: string, metadata: AskRunMetadata): Promise<void> {
  metadata.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

async function writeQuestionResult(args: {
  question: ResolvedAskQuestion;
  metadata: AskRunMetadata;
  metadataPath: string;
  result: AskQuestionResult;
  answerSummary?: string;
}): Promise<void> {
  await mkdir(args.question.artifactDir, { recursive: true });
  await writeAskQuestionSummary(args.question.answerSummaryPath, args.result, args.answerSummary);
  upsertQuestion(args.metadata, args.result);
  await writeAskMetadata(args.metadataPath, args.metadata);
}

async function runQuestion(args: {
  resolved: ResolvedAskRun;
  question: ResolvedAskQuestion;
  metadata: AskRunMetadata;
  metadataPath: string;
}): Promise<AskQuestionResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  await mkdir(args.question.artifactDir, { recursive: true });
  const backend = createAskBackend(args.resolved.backend, args.resolved.config);
  const backendResult = await backend.askQuestion({
    repoRoot: args.resolved.repoRoot,
    sourceSession: args.resolved.sourceSession,
    runId: args.resolved.runId,
    question: args.question,
    config: args.resolved.config,
  });
  const answerSummary =
    backendResult.status === "success" && args.resolved.saveAnswers
      ? redact(backendResult.summary)
      : undefined;
  const result: AskQuestionResult = {
    name: args.question.name,
    slug: args.question.slug,
    status:
      backendResult.status === "success"
        ? "succeeded"
        : backendResult.status === "interrupted"
          ? "interrupted"
          : "failed",
    questionSha256: args.question.questionSha256,
    backend: args.resolved.backend,
    artifactDir: args.question.artifactDir,
    answerSummaryPath: args.question.answerSummaryPath,
    sessionId: backendResult.sessionId,
    sessionIdAvailability: backendResult.sessionIdAvailability,
    sessionIdUnavailableReason: backendResult.sessionIdUnavailableReason,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    backendExitCode: backendResult.exitCode,
    backendSignal: backendResult.signal,
    error: backendResult.error
      ? scrubQuestion(backendResult.error, args.question.question)
      : undefined,
  };
  await writeQuestionResult({
    question: args.question,
    metadata: args.metadata,
    metadataPath: args.metadataPath,
    result,
    answerSummary,
  });
  return result;
}

export function renderAskDryRun(resolved: ResolvedAskRun): string {
  const lines = [
    `Ask dry-run: ${resolved.config.name}`,
    `Run ID: ${resolved.runId}`,
    `Run dir: ${resolved.runDir}`,
    `Source: ${resolved.backend} ${resolved.sourceSession}`,
    `Concurrency: ${resolved.concurrency}`,
    `Answer policy: ${resolved.answerPolicy}`,
    "",
    "Questions:",
  ];
  for (const question of resolved.questions) {
    lines.push(`- ${question.name}`);
    lines.push(`  slug: ${question.slug}`);
    lines.push(`  questionSha256: ${question.questionSha256}`);
    lines.push(`  summary: ${question.answerSummaryPath}`);
  }
  return `${lines.join("\n")}\n`;
}

export function askDryRunJson(resolved: ResolvedAskRun) {
  return {
    kind: "ask-run",
    name: resolved.config.name,
    runId: resolved.runId,
    runDir: resolved.runDir,
    source: {
      backend: resolved.backend,
      session: resolved.sourceSession,
      resolvedFrom: resolved.sourceResolvedFrom,
      env: resolved.sourceEnv,
    },
    concurrency: resolved.concurrency,
    answerPolicy: resolved.answerPolicy,
    saveAnswers: resolved.saveAnswers,
    questions: resolved.questions.map((question) => ({
      name: question.name,
      slug: question.slug,
      questionSha256: question.questionSha256,
      answerSummaryPath: question.answerSummaryPath,
    })),
  };
}

export async function runAsk(resolved: ResolvedAskRun, inputHash: string): Promise<AskRunMetadata> {
  const backend = createAskBackend(resolved.backend, resolved.config);
  await backend.checkAvailability();
  const metadataPath = resolve(resolved.runDir, "metadata.json");
  const metadata = initialAskMetadata(resolved, inputHash);
  await writeAskMetadata(metadataPath, metadata);
  await writeLatestPointers({
    repoRoot: resolved.repoRoot,
    stateRoot: resolved.stateRoot,
    runDir: resolved.runDir,
    metadata,
  });

  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < resolved.questions.length) {
      const question = resolved.questions[nextIndex];
      nextIndex += 1;
      try {
        await runQuestion({ resolved, question, metadata, metadataPath });
      } catch (error) {
        const result: AskQuestionResult = {
          name: question.name,
          slug: question.slug,
          status: "failed",
          questionSha256: question.questionSha256,
          backend: resolved.backend,
          artifactDir: question.artifactDir,
          answerSummaryPath: question.answerSummaryPath,
          error: scrubQuestion((error as Error).message, question.question),
        };
        await writeQuestionResult({ question, metadata, metadataPath, result });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, resolved.concurrency) }, async () => worker()),
  );
  await writeFile(resolve(resolved.runDir, "report.md"), renderReport(metadata));
  return metadata;
}
