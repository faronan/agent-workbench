import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UserFacingError } from "../src/errors.ts";
import { readMetadata } from "../src/metadata.ts";
import { printOpenCommand } from "../src/open.ts";
import { regenerateReport } from "../src/report.ts";
import { printStatus } from "../src/status.ts";
import type { RunMetadata } from "../src/types.ts";

const INVALID_METADATA_PATTERN = /legacy\/invalid metadata; rerun cc-fork-matrix/;

function validMetadata(): RunMetadata {
  return {
    schemaVersion: 1,
    toolVersion: "0.1.0",
    runId: "run",
    name: "demo",
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    repoRoot: "/repo",
    baseRef: "HEAD",
    baseHead: "abc",
    source: { backend: "claude-cli", session: "source" },
    matrixHash: "hash",
    dirtyBase: false,
    dirtyBaseStatus: "",
    variants: [
      {
        name: "A",
        slug: "a",
        status: "succeeded",
        branch: "branch-a",
        worktree: "/worktree/a",
        sessionId: "sid-a",
        openCommand: {
          kind: "resume-session",
          backend: "claude-cli",
          sessionId: "sid-a",
          sessionIdAvailability: "captured",
          command: {
            cwd: "/worktree/a",
            argv: ["claude", "--resume", "sid-a"],
            shellCommand: "cd /worktree/a && claude --resume sid-a",
          },
          launchers: {
            ghostty: {
              cwd: "/worktree/a",
              argv: [
                "open",
                "-na",
                "Ghostty.app",
                "--args",
                "--working-directory=/worktree/a",
                "-e",
                "claude",
                "--resume",
                "sid-a",
              ],
              shellCommand:
                "open -na Ghostty.app --args --working-directory=/worktree/a -e claude --resume sid-a",
            },
          },
        },
        verification: [],
        verificationCommands: [],
        diffstat: "",
        changedFiles: [],
        artifactDir: "/artifact/a",
      },
    ],
  };
}

function legacyResumeCommandMetadata() {
  const metadata = validMetadata() as unknown as Record<string, unknown>;
  const variants = metadata.variants as Array<Record<string, unknown>>;
  delete variants[0].openCommand;
  variants[0].resumeCommand = "cd /worktree/a && claude --resume sid-a";
  return metadata;
}

async function withMetadataFile(
  metadata: unknown,
  fn: (args: { runDir: string; metadataPath: string }) => Promise<void>,
): Promise<void> {
  const runDir = await mkdtemp(join(tmpdir(), "ccfm-metadata-"));
  const metadataPath = join(runDir, "metadata.json");
  try {
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await fn({ runDir, metadataPath });
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

function isInvalidMetadataError(error: unknown): boolean {
  return error instanceof UserFacingError && INVALID_METADATA_PATTERN.test(error.message);
}

test("readMetadata accepts current metadata schema", async () => {
  await withMetadataFile(validMetadata(), async ({ metadataPath }) => {
    const metadata = await readMetadata(metadataPath);
    assert.equal(metadata.variants[0].openCommand.kind, "resume-session");
  });
});

test("readMetadata rejects legacy resumeCommand metadata without migration", async () => {
  await withMetadataFile(legacyResumeCommandMetadata(), async ({ metadataPath }) => {
    await assert.rejects(() => readMetadata(metadataPath), isInvalidMetadataError);
  });
});

test("readMetadata rejects variants without openCommand", async () => {
  const metadata = validMetadata() as unknown as Record<string, unknown>;
  const variants = metadata.variants as Array<Record<string, unknown>>;
  delete variants[0].openCommand;

  await withMetadataFile(metadata, async ({ metadataPath }) => {
    await assert.rejects(() => readMetadata(metadataPath), isInvalidMetadataError);
  });
});

test("readMetadata rejects variants with invalid openCommand kind", async () => {
  const metadata = validMetadata() as unknown as Record<string, unknown>;
  const variants = metadata.variants as Array<Record<string, unknown>>;
  variants[0].openCommand = {
    ...(variants[0].openCommand as Record<string, unknown>),
    kind: "resumeCommand",
  };

  await withMetadataFile(metadata, async ({ metadataPath }) => {
    await assert.rejects(() => readMetadata(metadataPath), isInvalidMetadataError);
  });
});

test("readMetadata rejects variants with invalid open command invocation shape", async () => {
  const metadata = validMetadata() as unknown as Record<string, unknown>;
  const variants = metadata.variants as Array<Record<string, unknown>>;
  const openCommand = variants[0].openCommand as Record<string, unknown>;
  const command = openCommand.command as Record<string, unknown>;
  delete command.shellCommand;

  await withMetadataFile(metadata, async ({ metadataPath }) => {
    await assert.rejects(() => readMetadata(metadataPath), isInvalidMetadataError);
  });
});

test("readMetadata rejects verification results without code", async () => {
  const metadata = validMetadata() as unknown as Record<string, unknown>;
  const variants = metadata.variants as Array<Record<string, unknown>>;
  variants[0].verification = [
    {
      name: "test",
      command: "pnpm test",
      signal: null,
      durationMs: 1,
    },
  ];

  await withMetadataFile(metadata, async ({ metadataPath }) => {
    await assert.rejects(() => readMetadata(metadataPath), isInvalidMetadataError);
  });
});

test("readMetadata rejects verification results without signal", async () => {
  const metadata = validMetadata() as unknown as Record<string, unknown>;
  const variants = metadata.variants as Array<Record<string, unknown>>;
  variants[0].verification = [
    {
      name: "test",
      command: "pnpm test",
      code: 0,
      durationMs: 1,
    },
  ];

  await withMetadataFile(metadata, async ({ metadataPath }) => {
    await assert.rejects(() => readMetadata(metadataPath), isInvalidMetadataError);
  });
});

test("readMetadata rejects variants without verificationCommands", async () => {
  const metadata = validMetadata() as unknown as Record<string, unknown>;
  const variants = metadata.variants as Array<Record<string, unknown>>;
  delete variants[0].verificationCommands;

  await withMetadataFile(metadata, async ({ metadataPath }) => {
    await assert.rejects(() => readMetadata(metadataPath), isInvalidMetadataError);
  });
});

test("open, report, and status reject invalid metadata consistently", async () => {
  await withMetadataFile(legacyResumeCommandMetadata(), async ({ runDir }) => {
    await assert.rejects(() => printOpenCommand(runDir), isInvalidMetadataError);
    await assert.rejects(() => regenerateReport(runDir), isInvalidMetadataError);
    await assert.rejects(() => printStatus(runDir), isInvalidMetadataError);
  });
});

test("status prints a concise human summary by default", async () => {
  await withMetadataFile(validMetadata(), async ({ runDir }) => {
    const output = await printStatus(runDir);
    assert.match(output, /Run: demo \(run\)/);
    assert.match(output, /Kind: matrix-run/);
    assert.match(output, /Variants:/);
    assert.match(output, /- A \[a\]: succeeded/);
    assert.match(output, /Next:/);
    assert.doesNotMatch(output, /"openCommand"/);
    assert.match(output, /\n$/);
  });
});

test("status json prints validated current metadata", async () => {
  await withMetadataFile(validMetadata(), async ({ runDir }) => {
    const output = await printStatus(runDir, { json: true });
    assert.equal(JSON.parse(output).variants[0].openCommand.kind, "resume-session");
    assert.match(output, /\n$/);
  });
});
