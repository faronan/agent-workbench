import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseMatrixText } from "../src/matrix.ts";
import { resolveRun } from "../src/resolve.ts";
import { dryRunJson } from "../src/runner.ts";
import { runCommand } from "../src/shell.ts";

async function tempRepo() {
  const dir = await mkdtemp(join(tmpdir(), "ccfm-"));
  await runCommand("git", ["init"], dir);
  await runCommand("git", ["config", "user.email", "test@example.com"], dir);
  await runCommand("git", ["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "README.md"), "hello\n");
  await runCommand("git", ["add", "README.md"], dir);
  await runCommand("git", ["commit", "-m", "init"], dir);
  return dir;
}

test("resolves current source from CLAUDE_CODE_SESSION_ID", async () => {
  const repo = await tempRepo();
  const previous = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = "session-123";
  try {
    const parsed = parseMatrixText(
      `
version: 1
name: demo
repo: ${repo}
source:
  session: current
variants:
  - name: option-a
    prompt: do a
`,
      "yaml",
    );
    const resolved = await resolveRun(
      parsed.matrix,
      parsed.hash,
      { command: "dry-run" },
      "dry-run",
    );
    assert.equal(resolved.sourceSession, "session-123");
    assert.match(resolved.variants[0].branch, /cc-fork-matrix\/demo\//);
    assert.match(resolved.variants[0].worktree, /option-a$/);
    assert.doesNotMatch(JSON.stringify(dryRunJson(resolved)), /do a/);
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_CODE_SESSION_ID;
    } else {
      process.env.CLAUDE_CODE_SESSION_ID = previous;
    }
    await rm(repo, { recursive: true, force: true });
  }
});

test("dirty base fails by default", async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, "dirty.txt"), "dirty\n");
  const parsed = parseMatrixText(
    `
version: 1
name: demo
repo: ${repo}
source:
  session: explicit
variants:
  - name: option-a
    prompt: do a
`,
    "yaml",
  );
  await assert.rejects(
    () => resolveRun(parsed.matrix, parsed.hash, { command: "dry-run" }, "dry-run"),
    /uncommitted changes/,
  );
  await rm(repo, { recursive: true, force: true });
});

test("resolves Codex current source from CODEX_THREAD_ID", async () => {
  const repo = await tempRepo();
  const previous = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = "33333333-3333-3333-3333-333333333333";
  try {
    const parsed = parseMatrixText(
      `
version: 1
name: codex-current
repo: ${repo}
source:
  backend: codex-cli
  session: current
variants:
  - name: option-a
    prompt: do codex current
`,
      "yaml",
    );
    const resolved = await resolveRun(
      parsed.matrix,
      parsed.hash,
      { command: "dry-run" },
      "dry-run",
    );
    assert.equal(resolved.sourceSession, "33333333-3333-3333-3333-333333333333");
    assert.equal(resolved.sourceResolvedFrom, "env");
    assert.equal(resolved.sourceEnv, "CODEX_THREAD_ID");
    assert.doesNotMatch(JSON.stringify(dryRunJson(resolved)), /do codex current/);
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_THREAD_ID;
    } else {
      process.env.CODEX_THREAD_ID = previous;
    }
    await rm(repo, { recursive: true, force: true });
  }
});

test("Codex current source requires CODEX_THREAD_ID", async () => {
  const repo = await tempRepo();
  const previous = process.env.CODEX_THREAD_ID;
  delete process.env.CODEX_THREAD_ID;
  try {
    const parsed = parseMatrixText(
      `
version: 1
name: codex-current
repo: ${repo}
source:
  backend: codex-cli
  session: current
variants:
  - name: option-a
    prompt: do codex current
`,
      "yaml",
    );
    await assert.rejects(
      () => resolveRun(parsed.matrix, parsed.hash, { command: "dry-run" }, "dry-run"),
      /CODEX_THREAD_ID/,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_THREAD_ID;
    } else {
      process.env.CODEX_THREAD_ID = previous;
    }
    await rm(repo, { recursive: true, force: true });
  }
});

test("Codex backend rejects concurrent interactive launches", async () => {
  const repo = await tempRepo();
  const parsed = parseMatrixText(
    `
version: 1
name: codex-concurrent
repo: ${repo}
source:
  backend: codex-cli
  session: explicit
run:
  concurrency: 2
variants:
  - name: option-a
    prompt: do a
`,
    "yaml",
  );
  await assert.rejects(
    () => resolveRun(parsed.matrix, parsed.hash, { command: "dry-run" }, "dry-run"),
    /concurrency/,
  );
  await rm(repo, { recursive: true, force: true });
});
