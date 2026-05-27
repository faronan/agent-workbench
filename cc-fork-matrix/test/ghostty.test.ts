import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGhosttyAppleScript,
  type GhosttyOpenTarget,
  renderGhosttyDryRun,
} from "../src/ghostty.ts";

const trickyTargets: GhosttyOpenTarget[] = [
  {
    name: 'Quote "A"',
    slug: "quote-a",
    command: {
      cwd: "/tmp/work tree/quote'a",
      argv: ["/bin/echo", 'hello "world"', "line\nbreak", "slash\\value"],
      shellCommand:
        "cd '/tmp/work tree/quote'\\''a' && '/bin/echo' 'hello \"world\"' 'line\nbreak' 'slash\\value'",
    },
  },
  {
    name: "Plain B",
    slug: "plain-b",
    command: {
      cwd: "/tmp/plain-b",
      argv: ["codex", "resume", "session-b"],
      shellCommand: "cd '/tmp/plain-b' && 'codex' 'resume' 'session-b'",
    },
  },
  {
    name: "Plain C",
    slug: "plain-c",
    command: {
      cwd: "/tmp/plain-c",
      argv: ["claude", "--resume", "session-c"],
      shellCommand: "cd '/tmp/plain-c' && 'claude' '--resume' 'session-c'",
    },
  },
];

test("builds Ghostty tab AppleScript with escaped strings", () => {
  const script = buildGhosttyAppleScript(trickyTargets.slice(0, 2), "tabs");

  assert.match(script, /tell application "Ghostty"/);
  assert.match(script, /set cfg1 to new surface configuration/);
  assert.match(script, /set initial working directory of cfg1 to "\/tmp\/work tree\/quote'a"/);
  assert.match(script, /set win to new window with configuration cfg1/);
  assert.match(script, /set tab2 to new tab in win with configuration cfg2/);
  assert.match(script, /set term2 to focused terminal of tab2/);
  assert.match(script, /input text "cd '\/tmp\/work tree\/quote'\\\\''a'/);
  assert.match(script, /hello \\"world\\"/);
  assert.match(script, /line\\nbreak/);
  assert.match(script, /slash\\\\value/);
  assert.match(script, /send key "enter" to term1/);
});

test("builds Ghostty split AppleScript with alternating directions", () => {
  const script = buildGhosttyAppleScript(trickyTargets, "splits");

  assert.match(script, /set term2 to split term1 direction right with configuration cfg2/);
  assert.match(script, /set term3 to split term2 direction down with configuration cfg3/);
  assert.match(
    script,
    /input text "cd '\/tmp\/plain-c' && 'claude' '--resume' 'session-c'" to term3/,
  );
});

test("renders Ghostty dry-run output with manual commands and AppleScript", () => {
  const output = renderGhosttyDryRun(trickyTargets.slice(0, 1), "tabs");

  assert.match(output, /Ghostty layout: tabs/);
  assert.match(output, /Manual commands:/);
  assert.match(output, /- Quote "A": cd '\/tmp\/work tree\/quote'\\''a'/);
  assert.match(output, /AppleScript:/);
  assert.match(output, /tell application "Ghostty"/);
});
