import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

for (const skillPath of [
  "skills/codex/cc-fork-matrix/SKILL.md",
  "skills/claude/cc-fork-matrix/SKILL.md",
]) {
  test(`${skillPath} uses the installed wrapper and documents follow-up protocol`, async () => {
    const text = await readFile(join(packageRoot, skillPath), "utf8");

    assert.match(text, /## Command/);
    assert.match(text, /```bash\ncc-fork-matrix\n```/);
    assert.match(text, /\$HOME\/\.local\/bin\/cc-fork-matrix/);
    assert.doesNotMatch(text, /node --experimental-strip-types .*src\/cli\.ts/);
    assert.match(text, /status --last --json/);
    assert.match(text, /finalize --last --json/);
    assert.match(text, /cleanup --last --except/);
    assert.match(text, /cleanup --last --dry-run --json/);
    assert.match(text, /report --last/);
    assert.match(text, /Implementation work uses matrix run/);
    assert.match(text, /Advisory questions use ask-only fan-out/);
    assert.match(text, /Use `--terminal zellij` only when the user explicitly requested Zellij/);
    assert.match(text, /Do not run destructive cleanup before showing the dry-run JSON result/);
  });
}
