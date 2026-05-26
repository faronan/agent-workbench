import assert from "node:assert/strict";
import test from "node:test";
import { parseMatrixText } from "../src/matrix.ts";

test("parses yaml matrix with block prompt", () => {
  const parsed = parseMatrixText(
    `
version: 1
name: auth-matrix
source:
  backend: claude-cli
  session: current
verification:
  commands:
    - name: test
      command: pnpm test
variants:
  - name: zod-contract
    prompt: |
      Explore zod.
      Keep scope narrow.
`,
    "yaml",
  );
  assert.equal(parsed.matrix.name, "auth-matrix");
  assert.equal(parsed.matrix.variants[0].prompt, "Explore zod.\nKeep scope narrow.");
  assert.equal(parsed.matrix.verification?.commands?.[0].command, "pnpm test");
});

test("parses json matrix", () => {
  const parsed = parseMatrixText(
    JSON.stringify({
      version: 1,
      name: "json-matrix",
      variants: [{ name: "a", prompt: "do a" }],
    }),
    "json",
  );
  assert.equal(parsed.matrix.variants.length, 1);
});

test("parses toml matrix with array tables", () => {
  const parsed = parseMatrixText(
    `
version = 1
name = "toml-matrix"

[source]
session = "current"

[[verification.commands]]
name = "test"
command = "pnpm test"

[[variants]]
name = "a"
prompt = "do a"
`,
    "toml",
  );
  assert.equal(parsed.matrix.name, "toml-matrix");
  assert.equal(parsed.matrix.variants[0].name, "a");
  assert.equal(parsed.matrix.verification?.commands?.[0].name, "test");
});
