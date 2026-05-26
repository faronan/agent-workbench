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
