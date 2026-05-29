import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoLocalCommand =
  "node --experimental-strip-types /Users/toshiki.ito/ghq/github.com/faronan/agent-workbench/cc-fork-matrix/src/cli.ts";

for (const skillPath of [
  "skills/codex/cc-fork-matrix/SKILL.md",
  "skills/claude/cc-fork-matrix/SKILL.md",
]) {
  test(`${skillPath} centralizes the repo-local command and documents follow-up protocol`, async () => {
    const text = await readFile(join(packageRoot, skillPath), "utf8");

    assert.match(text, /## Command/);
    assert.equal(
      text.match(new RegExp(repoLocalCommand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length,
      1,
    );
    assert.match(text, /status --last --json/);
    assert.match(text, /finalize --last --json/);
    assert.match(text, /cleanup --last --except/);
    assert.match(text, /cleanup --last --dry-run --json/);
    assert.match(text, /report --last/);
  });
}
