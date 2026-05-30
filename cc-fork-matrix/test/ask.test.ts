import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseAskConfigText } from "../src/ask-config.ts";
import { resolveAskRun } from "../src/ask-resolve.ts";
import {
  askDryRunJson,
  createAskMetadataWriter,
  renderAskDryRun,
  runAsk,
} from "../src/ask-runner.ts";
import { cleanupRun } from "../src/cleanup.ts";
import { finalizeRun } from "../src/finalize.ts";
import { readMetadata } from "../src/metadata.ts";
import { printOpenCommand } from "../src/open.ts";
import { regenerateReport } from "../src/report.ts";
import { runCommand } from "../src/shell.ts";
import { printStatus } from "../src/status.ts";
import type { AskQuestionResult, AskRunMetadata } from "../src/types.ts";

const HIDDEN_QUESTION = "Hidden contract question with OPENAI_API_KEY=secret";

async function tempRepo() {
  const dir = await mkdtemp(join(tmpdir(), "ccfm-ask-"));
  await runCommand("git", ["init"], dir);
  await runCommand("git", ["config", "user.email", "test@example.com"], dir);
  await runCommand("git", ["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "README.md"), "hello\n");
  await runCommand("git", ["add", "README.md"], dir);
  await runCommand("git", ["commit", "-m", "init"], dir);
  return dir;
}

function askYaml(repo: string, command = "claude") {
  return `
version: 1
name: architecture-advice
repo: ${repo}
source:
  backend: claude-cli
  session: explicit-session
ask:
  concurrency: 2
backend:
  claude:
    command: ${command}
questions:
  - name: contract-first
    question: |
      ${HIDDEN_QUESTION}
  - name: minimal-change
    question: |
      Evaluate minimal change.
`;
}

function askMetadata(runDir: string): AskRunMetadata {
  return {
    schemaVersion: 1,
    kind: "ask-run",
    toolVersion: "0.1.0",
    runId: "ask-run",
    name: "ask demo",
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    repoRoot: "/repo",
    source: {
      backend: "claude-cli",
      session: "source-session",
      resolvedFrom: "explicit",
    },
    inputHash: "hash",
    answerPolicy: "final-summary-only",
    saveAnswers: true,
    questions: [
      {
        name: "contract-first",
        slug: "contract-first",
        status: "succeeded",
        questionSha256: "question-hash",
        backend: "claude-cli",
        artifactDir: join(runDir, "contract-first"),
        answerSummaryPath: join(runDir, "contract-first", "summary.md"),
        sessionId: "11111111-1111-1111-1111-111111111111",
        sessionIdAvailability: "captured",
        backendExitCode: 0,
        backendSignal: null,
        startedAt: "2026-05-30T00:00:00.000Z",
        finishedAt: "2026-05-30T00:00:01.000Z",
        durationMs: 1000,
      },
    ],
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function askQuestionResult(name: string, runDir: string): AskQuestionResult {
  return {
    name,
    slug: name,
    status: "succeeded",
    questionSha256: `hash-${name}`,
    backend: "claude-cli",
    artifactDir: join(runDir, name),
    answerSummaryPath: join(runDir, name, "summary.md"),
  };
}

async function withAskMetadata(
  fn: (args: { runDir: string; metadata: AskRunMetadata }) => Promise<void>,
): Promise<void> {
  const runDir = await mkdtemp(join(tmpdir(), "ccfm-ask-metadata-"));
  try {
    const metadata = askMetadata(runDir);
    await writeFile(join(runDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    await fn({ runDir, metadata });
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

test("serializes ask metadata writes through one queue", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "ccfm-ask-serialized-"));
  try {
    const metadata = askMetadata(runDir);
    metadata.questions = [];
    const metadataPath = join(runDir, "metadata.json");
    const releases: Array<() => void> = [];
    const persistedSlugs: string[][] = [];
    const writer = createAskMetadataWriter({
      metadata,
      metadataPath,
      persist: async (path, nextMetadata) => {
        const gate = deferred();
        releases.push(gate.resolve);
        await gate.promise;
        persistedSlugs.push(nextMetadata.questions.map((question) => question.slug));
        await writeFile(path, `${JSON.stringify(nextMetadata, null, 2)}\n`);
      },
    });

    const first = writer(askQuestionResult("first", runDir));
    const second = writer(askQuestionResult("second", runDir));

    await Promise.resolve();
    await Promise.resolve();
    assert.equal(releases.length, 1);

    releases[0]();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(releases.length, 2);

    releases[1]();
    await second;

    const persisted = JSON.parse(await readFile(metadataPath, "utf8")) as AskRunMetadata;
    assert.deepEqual(persistedSlugs, [["first"], ["first", "second"]]);
    assert.deepEqual(
      persisted.questions.map((question) => question.slug),
      ["first", "second"],
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("parses ask schema without matrix variants", async () => {
  const repo = await tempRepo();
  try {
    const parsed = parseAskConfigText(askYaml(repo), "yaml");

    assert.equal(parsed.config.name, "architecture-advice");
    assert.equal(parsed.config.questions.length, 2);
    assert.equal(parsed.config.questions[0].question, HIDDEN_QUESTION);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("rejects matrix-style variants for ask schema", () => {
  assert.throws(
    () =>
      parseAskConfigText(
        `
version: 1
name: wrong-shape
variants:
  - name: option-a
    prompt: do a
`,
        "yaml",
      ),
    /questions are required/,
  );
});

test("resolves current Claude source and dry-run omits raw question", async () => {
  const repo = await tempRepo();
  const previous = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = "source-current-session";
  try {
    const parsed = parseAskConfigText(
      `
version: 1
name: current-ask
repo: ${repo}
source:
  backend: claude-cli
  session: current
questions:
  - name: contract-first
    question: |
      ${HIDDEN_QUESTION}
`,
      "yaml",
    );
    const resolved = await resolveAskRun(parsed.config, parsed.hash, { command: "ask" }, "dry-run");

    assert.equal(resolved.sourceSession, "source-current-session");
    assert.equal(resolved.sourceResolvedFrom, "env");
    assert.equal(resolved.sourceEnv, "CLAUDE_CODE_SESSION_ID");
    assert.doesNotMatch(renderAskDryRun(resolved), new RegExp(HIDDEN_QUESTION));
    assert.doesNotMatch(JSON.stringify(askDryRunJson(resolved)), new RegExp(HIDDEN_QUESTION));
    assert.equal(typeof resolved.questions[0].questionSha256, "string");
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_CODE_SESSION_ID;
    } else {
      process.env.CLAUDE_CODE_SESSION_ID = previous;
    }
    await rm(repo, { recursive: true, force: true });
  }
});

test("runs ask fan-out with fake Claude and stores only answer summaries", async () => {
  const repo = await tempRepo();
  const fakeClaude = join(repo, "fake-claude-ask.sh");
  const calls = join(repo, "fake-claude-ask-calls.log");
  await writeFile(
    fakeClaude,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "fake claude 0.0.0"
  exit 0
fi
for arg do
  printf '%s\\n' "$arg" >> "${calls}"
done
echo '{"session_id":"11111111-1111-1111-1111-111111111111","result":"Safe answer summary"}'
`,
  );
  await chmod(fakeClaude, 0o755);
  await runCommand("git", ["add", "fake-claude-ask.sh"], repo);
  await runCommand("git", ["commit", "-m", "add fake claude ask"], repo);

  try {
    const parsed = parseAskConfigText(askYaml(repo, fakeClaude), "yaml");
    const resolved = await resolveAskRun(
      parsed.config,
      parsed.hash,
      { command: "ask", runId: "ask-success" },
      "run",
    );
    const metadata = await runAsk(resolved, parsed.hash);

    assert.equal(metadata.kind, "ask-run");
    assert.equal(metadata.questions[0].status, "succeeded");
    assert.equal(metadata.questions[0].sessionId, "11111111-1111-1111-1111-111111111111");
    assert.doesNotMatch(JSON.stringify(metadata), new RegExp(HIDDEN_QUESTION));

    const summary = await readFile(resolved.questions[0].answerSummaryPath, "utf8");
    assert.match(summary, /Safe answer summary/);
    assert.doesNotMatch(summary, new RegExp(HIDDEN_QUESTION));

    const report = await readFile(join(resolved.runDir, "report.md"), "utf8");
    assert.match(report, /contract-first/);
    assert.match(report, /Question hash/);
    assert.doesNotMatch(report, new RegExp(HIDDEN_QUESTION));

    const callLog = await readFile(calls, "utf8");
    assert.match(callLog, /--tools/);
    assert.match(callLog, /\n\n/);
    assert.match(callLog, /--permission-mode/);
    assert.match(callLog, /\nplan\n/);
    assert.match(callLog, /--output-format/);
    assert.match(callLog, /\njson\n/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("persists every ask question after high-concurrency fan-out", async () => {
  const repo = await tempRepo();
  const fakeClaude = join(repo, "fake-claude-ask-many.sh");
  await writeFile(
    fakeClaude,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "fake claude 0.0.0"
  exit 0
fi
echo '{"result":"Safe answer summary"}'
`,
  );
  await chmod(fakeClaude, 0o755);
  await runCommand("git", ["add", "fake-claude-ask-many.sh"], repo);
  await runCommand("git", ["commit", "-m", "add many fake claude ask"], repo);

  try {
    const questionCount = 12;
    const questions = Array.from(
      { length: questionCount },
      (_, index) => `  - name: q-${String(index + 1).padStart(2, "0")}
    question: |
      Evaluate option ${index + 1}.
`,
    ).join("");
    const parsed = parseAskConfigText(
      `
version: 1
name: high-concurrency-ask
repo: ${repo}
source:
  backend: claude-cli
  session: explicit-session
ask:
  concurrency: ${questionCount}
backend:
  claude:
    command: ${fakeClaude}
questions:
${questions}`,
      "yaml",
    );
    const resolved = await resolveAskRun(
      parsed.config,
      parsed.hash,
      { command: "ask", runId: "ask-many" },
      "run",
    );

    await runAsk(resolved, parsed.hash);

    const persisted = await readMetadata(join(resolved.runDir, "metadata.json"));
    assert.equal(persisted.kind, "ask-run");
    if (persisted.kind !== "ask-run") {
      assert.fail("expected ask-run metadata");
    }
    assert.equal(persisted.questions.length, questionCount);
    assert.deepEqual(
      persisted.questions.map((question) => question.slug).sort(),
      Array.from(
        { length: questionCount },
        (_, index) => `q-${String(index + 1).padStart(2, "0")}`,
      ),
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("ask failures redact stderr and do not persist raw questions", async () => {
  const repo = await tempRepo();
  const fakeClaude = join(repo, "fake-claude-ask-fail.sh");
  await writeFile(
    fakeClaude,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "fake claude 0.0.0"
  exit 0
fi
echo "${HIDDEN_QUESTION}" >&2
echo "OPENAI_API_KEY=supersecret" >&2
exit 64
`,
  );
  await chmod(fakeClaude, 0o755);
  await runCommand("git", ["add", "fake-claude-ask-fail.sh"], repo);
  await runCommand("git", ["commit", "-m", "add failing fake claude ask"], repo);

  try {
    const parsed = parseAskConfigText(askYaml(repo, fakeClaude), "yaml");
    const resolved = await resolveAskRun(
      parsed.config,
      parsed.hash,
      { command: "ask", runId: "ask-failure" },
      "run",
    );
    const metadata = await runAsk(resolved, parsed.hash);

    assert.equal(metadata.questions[0].status, "failed");
    assert.doesNotMatch(JSON.stringify(metadata), new RegExp(HIDDEN_QUESTION));
    assert.doesNotMatch(JSON.stringify(metadata), /supersecret/);
    assert.match(metadata.questions[0].error ?? "", /\[REDACTED\]/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("malformed Claude JSON is a per-question failure without raw stdout", async () => {
  const repo = await tempRepo();
  const fakeClaude = join(repo, "fake-claude-ask-malformed.sh");
  await writeFile(
    fakeClaude,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "fake claude 0.0.0"
  exit 0
fi
echo "not json ${HIDDEN_QUESTION}"
`,
  );
  await chmod(fakeClaude, 0o755);
  await runCommand("git", ["add", "fake-claude-ask-malformed.sh"], repo);
  await runCommand("git", ["commit", "-m", "add malformed fake claude ask"], repo);

  try {
    const parsed = parseAskConfigText(askYaml(repo, fakeClaude), "yaml");
    const resolved = await resolveAskRun(
      parsed.config,
      parsed.hash,
      { command: "ask", runId: "ask-malformed" },
      "run",
    );
    const metadata = await runAsk(resolved, parsed.hash);

    assert.equal(metadata.questions[0].status, "failed");
    assert.match(metadata.questions[0].error ?? "", /JSON/);
    assert.doesNotMatch(JSON.stringify(metadata), new RegExp(HIDDEN_QUESTION));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("status and report accept ask metadata but open finalize cleanup reject it", async () => {
  await withAskMetadata(async ({ runDir }) => {
    const metadata = await readMetadata(join(runDir, "metadata.json"));
    assert.equal(metadata.kind, "ask-run");

    const status = await printStatus(runDir);
    assert.match(status, /Run: ask demo \(ask-run\)/);
    assert.match(status, /Questions:/);
    assert.match(status, /open\/finalize\/cleanup: not supported for ask runs/);

    const statusJson = await printStatus(runDir, { json: true });
    assert.equal(JSON.parse(statusJson).kind, "ask-run");

    const report = await regenerateReport(runDir);
    assert.match(report, /cc-fork-matrix ask report/);
    assert.match(report, /contract-first/);

    await assert.rejects(
      () => printOpenCommand(runDir),
      /ask runs because they have no worktrees/i,
    );
    await assert.rejects(() => finalizeRun(runDir), /ask run/i);
    await assert.rejects(() => cleanupRun(runDir, { dryRun: true }), /ask run/i);
  });
});
