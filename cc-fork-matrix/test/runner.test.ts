import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseMatrixText } from "../src/matrix.ts";
import { resolveRun } from "../src/resolve.ts";
import { runMatrix } from "../src/runner.ts";
import { runCommand } from "../src/shell.ts";

async function tempRepo() {
  const dir = await mkdtemp(join(tmpdir(), "ccfm-run-"));
  await runCommand("git", ["init"], dir);
  await runCommand("git", ["config", "user.email", "test@example.com"], dir);
  await runCommand("git", ["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "README.md"), "hello\n");
  await runCommand("git", ["add", "README.md"], dir);
  await runCommand("git", ["commit", "-m", "init"], dir);
  return dir;
}

test("runs matrix with a fake Claude CLI", async () => {
  const repo = await tempRepo();
  const fakeClaude = join(repo, "fake-claude.sh");
  await writeFile(
    fakeClaude,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "fake claude 0.0.0"
  exit 0
fi
printf 'agent output\\n' > agent-output.txt
echo '{"session_id":"11111111-1111-1111-1111-111111111111","result":"done"}'
`,
  );
  await chmod(fakeClaude, 0o755);
  await runCommand("git", ["add", "fake-claude.sh"], repo);
  await runCommand("git", ["commit", "-m", "add fake claude"], repo);

  try {
    const parsed = parseMatrixText(
      `
version: 1
name: fake-run
repo: ${repo}
source:
  backend: claude-cli
  session: explicit-session
run:
  stateRoot: .state
backend:
  claude:
    command: ${fakeClaude}
verification:
  commands:
    - name: output
      command: test -f agent-output.txt
variants:
  - name: option-a
    worktree: ${repo}-claude-option-a
    prompt: do a
`,
      "yaml",
    );
    const resolved = await resolveRun(
      parsed.matrix,
      parsed.hash,
      { command: "run", runId: "fake" },
      "run",
    );
    const metadata = await runMatrix(resolved, parsed.hash);
    assert.equal(metadata.variants[0].status, "succeeded");
    assert.equal(metadata.variants[0].sessionId, "11111111-1111-1111-1111-111111111111");
    assert.deepEqual(metadata.variants[0].changedFiles, ["agent-output.txt"]);
    assert.match(await readFile(join(resolved.runDir, "report.md"), "utf8"), /option-a/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("runs matrix with a fake Codex CLI from CODEX_THREAD_ID", async () => {
  const repo = await tempRepo();
  const fakeCodex = join(repo, "fake-codex.sh");
  const calls = join(repo, "codex-calls.log");
  await writeFile(
    fakeCodex,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
if [ "$1" = "fork" ] && [ "$2" = "--help" ]; then
  cat <<'HELP'
Usage: codex fork [OPTIONS] [SESSION_ID] [PROMPT]
  -C, --cd <DIR>
HELP
  exit 0
fi
if [ "$1" = "fork" ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "-C" ]; then
      shift
      cd "$1" || exit 1
    fi
    shift
  done
  printf 'codex output\\n' > codex-output.txt
  exit 0
fi
exit 64
`,
  );
  await chmod(fakeCodex, 0o755);
  await runCommand("git", ["add", "fake-codex.sh"], repo);
  await runCommand("git", ["commit", "-m", "add fake codex"], repo);

  const previous = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = "22222222-2222-2222-2222-222222222222";
  try {
    const parsed = parseMatrixText(
      `
version: 1
name: codex-run
repo: ${repo}
source:
  backend: codex-cli
  session: current
run:
  stateRoot: .state
backend:
  codex:
    command: ${fakeCodex}
verification:
  commands:
    - name: output
      command: test -f codex-output.txt
variants:
  - name: option-a
    worktree: ${repo}-codex-option-a
    prompt: do codex a
`,
      "yaml",
    );
    const resolved = await resolveRun(
      parsed.matrix,
      parsed.hash,
      { command: "run", runId: "fake-codex" },
      "run",
    );
    const metadata = await runMatrix(resolved, parsed.hash);
    assert.equal(metadata.source.session, "22222222-2222-2222-2222-222222222222");
    assert.equal(metadata.source.resolvedFrom, "env");
    assert.equal(metadata.source.env, "CODEX_THREAD_ID");
    assert.equal(metadata.variants[0].status, "succeeded");
    assert.equal(metadata.variants[0].sessionId, undefined);
    assert.equal(metadata.variants[0].sessionIdAvailability, "unavailable");
    assert.match(metadata.variants[0].sessionIdUnavailableReason ?? "", /does not expose/i);
    assert.equal(metadata.variants[0].resumeCommand, undefined);
    assert.deepEqual(metadata.variants[0].changedFiles, ["codex-output.txt"]);

    const callLog = await readFile(calls, "utf8");
    assert.match(callLog, /^fork --help$/m);
    assert.match(callLog, /^fork 22222222-2222-2222-2222-222222222222 [\s\S]* -C .*option-a$/m);
    assert.doesNotMatch(JSON.stringify(metadata), /do codex a/);
    assert.doesNotMatch(await readFile(join(resolved.runDir, "report.md"), "utf8"), /do codex a/);
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_THREAD_ID;
    } else {
      process.env.CODEX_THREAD_ID = previous;
    }
    await rm(repo, { recursive: true, force: true });
  }
});

test("runs matrix with a fake Codex CLI from an explicit source session", async () => {
  const repo = await tempRepo();
  const fakeCodex = join(repo, "fake-codex-explicit.sh");
  const calls = join(repo, "codex-explicit-calls.log");
  await writeFile(
    fakeCodex,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
if [ "$1" = "fork" ] && [ "$2" = "--help" ]; then
  printf 'Usage: codex fork [OPTIONS] [SESSION_ID] [PROMPT]\\n  -C, --cd <DIR>\\n'
  exit 0
fi
if [ "$1" = "fork" ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "-C" ]; then
      shift
      cd "$1" || exit 1
    fi
    shift
  done
  printf 'explicit output\\n' > explicit-output.txt
  exit 0
fi
exit 64
`,
  );
  await chmod(fakeCodex, 0o755);
  await runCommand("git", ["add", "fake-codex-explicit.sh"], repo);
  await runCommand("git", ["commit", "-m", "add explicit fake codex"], repo);

  const previous = process.env.CODEX_THREAD_ID;
  delete process.env.CODEX_THREAD_ID;
  try {
    const parsed = parseMatrixText(
      `
version: 1
name: codex-explicit-run
repo: ${repo}
source:
  backend: codex-cli
  session: explicit-codex-session
run:
  stateRoot: .state
backend:
  codex:
    command: ${fakeCodex}
variants:
  - name: option-a
    worktree: ${repo}-codex-explicit-option-a
    prompt: do explicit codex
`,
      "yaml",
    );
    const resolved = await resolveRun(
      parsed.matrix,
      parsed.hash,
      { command: "run", runId: "fake-codex-explicit" },
      "run",
    );
    const metadata = await runMatrix(resolved, parsed.hash);
    assert.equal(metadata.source.session, "explicit-codex-session");
    assert.equal(metadata.source.resolvedFrom, "explicit");
    assert.equal(metadata.source.env, undefined);
    assert.equal(metadata.variants[0].status, "succeeded");
    assert.deepEqual(metadata.variants[0].changedFiles, ["explicit-output.txt"]);
    assert.match(await readFile(calls, "utf8"), /^fork explicit-codex-session [\s\S]* -C /m);
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_THREAD_ID;
    } else {
      process.env.CODEX_THREAD_ID = previous;
    }
    await rm(repo, { recursive: true, force: true });
  }
});
