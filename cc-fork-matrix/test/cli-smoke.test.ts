import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCommand } from "../src/shell.ts";
import type { RunMetadata } from "../src/types.ts";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageRoot, "src", "cli.ts");
const INVALID_METADATA_MESSAGE = "legacy/invalid metadata; rerun cc-fork-matrix";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

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
        diffstat: "",
        changedFiles: [],
        artifactDir: "/artifact/a",
      },
    ],
  };
}

function legacyResumeCommandMetadata(): unknown {
  const metadata = structuredClone(validMetadata()) as unknown as Record<string, unknown>;
  const variants = metadata.variants as Array<Record<string, unknown>>;
  delete variants[0].openCommand;
  variants[0].resumeCommand = "cd /worktree/a && claude --resume sid-a";
  return metadata;
}

async function runCli(args: string[], input?: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", cliPath, ...args], {
      cwd: packageRoot,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

async function withRunDir(
  metadata: unknown,
  fn: (args: { runDir: string }) => Promise<void>,
): Promise<void> {
  const runDir = await mkdtemp(join(tmpdir(), "ccfm-cli-"));
  try {
    await writeFile(join(runDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    await fn({ runDir });
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

async function tempRepo() {
  const dir = await mkdtemp(join(tmpdir(), "ccfm-cli-launch-"));
  await runCommand("git", ["init"], dir);
  await runCommand("git", ["config", "user.email", "test@example.com"], dir);
  await runCommand("git", ["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "README.md"), "hello\n");
  await runCommand("git", ["add", "README.md"], dir);
  await runCommand("git", ["commit", "-m", "init"], dir);
  return dir;
}

async function withMatrixFile(
  text: string,
  fn: (args: { matrixPath: string }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "ccfm-cli-matrix-"));
  try {
    const matrixPath = join(dir, "matrix.yaml");
    await writeFile(matrixPath, text);
    await fn({ matrixPath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

for (const command of ["open", "status", "report"] as const) {
  test(`${command} reports legacy metadata as a user-facing CLI error`, async () => {
    await withRunDir(legacyResumeCommandMetadata(), async ({ runDir }) => {
      const result = await runCli([command, runDir]);

      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(INVALID_METADATA_MESSAGE));
      assert.doesNotMatch(result.stderr, /TypeError/);
      assert.doesNotMatch(result.stderr, /Cannot read properties/);
      assert.doesNotMatch(result.stderr, /\n\s+at /);
    });
  });
}

test("status prints valid metadata through the CLI", async () => {
  await withRunDir(validMetadata(), async ({ runDir }) => {
    const result = await runCli(["status", runDir]);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const metadata = JSON.parse(result.stdout) as RunMetadata;
    assert.equal(metadata.variants[0].openCommand.kind, "resume-session");
  });
});

test("run launch dry-run prints Ghostty launch targets without prompt text", async () => {
  const repo = await tempRepo();
  try {
    await withMatrixFile(
      `
version: 1
name: cli-codex-launch
repo: ${repo}
source:
  backend: codex-cli
  session: source-session
variants:
  - name: option-a
    prompt: hidden cli prompt
`,
      async ({ matrixPath }) => {
        const result = await runCli([
          "run",
          matrixPath,
          "--launch",
          "--terminal",
          "ghostty",
          "--dry-run",
        ]);

        assert.equal(result.code, 0);
        assert.equal(result.stderr, "");
        assert.match(result.stdout, /Launch target: ghostty tabs/);
        assert.match(result.stdout, /promptSha256:/);
        assert.doesNotMatch(result.stdout, /hidden cli prompt/);
        assert.doesNotMatch(result.stdout, /codex fork/);
      },
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("run launch dry-run prints Zellij launch targets as json", async () => {
  const repo = await tempRepo();
  try {
    await withMatrixFile(
      `
version: 1
name: cli-codex-launch-json
repo: ${repo}
source:
  backend: codex-cli
  session: source-session
variants:
  - name: option-a
    prompt: hidden zellij prompt
`,
      async ({ matrixPath }) => {
        const result = await runCli([
          "run",
          matrixPath,
          "--launch",
          "--terminal",
          "zellij",
          "--dry-run",
          "--json",
        ]);

        assert.equal(result.code, 0);
        assert.equal(result.stderr, "");
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.launch, true);
        assert.equal(payload.terminal, "zellij");
        assert.equal(payload.layout, "tabs");
        assert.equal(payload.variants[0].launchTarget.terminal, "zellij");
        assert.equal(payload.variants[0].launchTarget.layout, "tabs");
        assert.equal(typeof payload.variants[0].promptSha256, "string");
        assert.doesNotMatch(result.stdout, /hidden zellij prompt/);
        assert.doesNotMatch(result.stdout, /codex fork/);
      },
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("run launch dry-run accepts Claude backend without prompt text", async () => {
  const repo = await tempRepo();
  try {
    await withMatrixFile(
      `
version: 1
name: cli-claude-launch
repo: ${repo}
source:
  backend: claude-cli
  session: source-session
verification:
  commands:
    - name: test
      command: pnpm test
variants:
  - name: option-a
    prompt: hidden claude prompt
`,
      async ({ matrixPath }) => {
        const result = await runCli([
          "run",
          matrixPath,
          "--launch",
          "--terminal",
          "ghostty",
          "--dry-run",
        ]);

        assert.equal(result.code, 0);
        assert.equal(result.stderr, "");
        assert.match(result.stdout, /Source: claude-cli source-session/);
        assert.match(result.stdout, /Launch target: ghostty tabs/);
        assert.match(result.stdout, /promptSha256:/);
        assert.match(result.stdout, /verification: test/);
        assert.doesNotMatch(result.stdout, /hidden claude prompt/);
        assert.doesNotMatch(result.stdout, /claude --resume/);
      },
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("launch dry-run reads ephemeral matrix from stdin", async () => {
  const repo = await tempRepo();
  try {
    const result = await runCli(
      [
        "dry-run",
        "--stdin",
        "--format",
        "yaml",
        "--source",
        "source-session",
        "--launch",
        "--terminal",
        "ghostty",
      ],
      `
version: 1
name: stdin-claude-launch
repo: ${repo}
source:
  backend: claude-cli
variants:
  - name: option-a
    prompt: hidden stdin prompt
`,
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Source: claude-cli source-session/);
    assert.match(result.stdout, /Launch target: ghostty tabs/);
    assert.doesNotMatch(result.stdout, /hidden stdin prompt/);
    assert.doesNotMatch(result.stdout, /claude --resume/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("run launch requires a terminal", async () => {
  const result = await runCli(["run", "matrix.yaml", "--launch"]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires --terminal/);
});

test("run launch dry-run rejects unsupported backend", async () => {
  const repo = await tempRepo();
  try {
    await withMatrixFile(
      `
version: 1
name: cli-unsupported-launch
repo: ${repo}
source:
  backend: claude-agent-sdk
  session: source-session
variants:
  - name: option-a
    prompt: do a
`,
      async ({ matrixPath }) => {
        const result = await runCli([
          "run",
          matrixPath,
          "--launch",
          "--terminal",
          "ghostty",
          "--dry-run",
        ]);

        assert.equal(result.code, 1);
        assert.match(result.stderr, /claude-cli or codex-cli/);
      },
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("run launch rejects Zellij split layout", async () => {
  const result = await runCli([
    "run",
    "matrix.yaml",
    "--launch",
    "--terminal",
    "zellij",
    "--layout",
    "splits",
    "--dry-run",
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /zellij launch mode only supports the tabs layout/i);
});
