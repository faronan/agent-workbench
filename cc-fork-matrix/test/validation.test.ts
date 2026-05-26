import assert from "node:assert/strict";
import test from "node:test";
import { redact } from "../src/redaction.ts";
import { assertSafeVerificationCommands } from "../src/validation.ts";

test("rejects forbidden verification commands", () => {
  assert.throws(
    () => assertSafeVerificationCommands([{ name: "commit", command: "git commit -m test" }]),
    /forbidden/,
  );
});

test("redacts common secret patterns", () => {
  assert.equal(redact("ANTHROPIC_API_KEY=abc123"), "ANTHROPIC_API_KEY=[REDACTED]");
  assert.equal(redact("token: abc123"), "token:[REDACTED]");
});
