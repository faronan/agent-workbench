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
