#!/usr/bin/env -S node --experimental-strip-types
import { resolve } from "node:path";
import { cleanupRun, renderCleanupResult } from "./cleanup.ts";
import { UserFacingError } from "./errors.ts";
import { launchDryRunJson, renderLaunchDryRun } from "./launch.ts";
import { parseMatrixText, readMatrixFile } from "./matrix.ts";
import { printOpenCommand } from "./open.ts";
import { regenerateReport } from "./report.ts";
import { resolveRun } from "./resolve.ts";
import { dryRunJson, launchMatrix, renderDryRun, runMatrix } from "./runner.ts";
import { MATRIX_SCHEMA } from "./schema.ts";
import { printStatus } from "./status.ts";
import type { CliOptions, MatrixFormat } from "./types.ts";

function help(): string {
  return `cc-fork-matrix

Usage:
  cc-fork-matrix run <matrix.yaml>
  cc-fork-matrix run <matrix.yaml> --launch --terminal ghostty|zellij [--layout tabs|splits] [--dry-run]
  cc-fork-matrix run --stdin --format yaml
  cc-fork-matrix dry-run <matrix.yaml|--stdin>
  cc-fork-matrix report <run-dir>
  cc-fork-matrix status <run-dir>
  cc-fork-matrix open <run-dir> [--variant <name>] [--json]
  cc-fork-matrix open <run-dir> --terminal ghostty [--layout tabs|splits] [--variant <name>] [--dry-run]
  cc-fork-matrix cleanup <run-dir> [--dry-run] [--force] [--json]
  cc-fork-matrix schema

Options:
  --repo <path>
  --source <current|session-id|session-name>
  --backend <claude-cli|codex-cli>
  --concurrency <n>
  --state-root <path>
  --run-id <id>
  --allow-dirty-base
  --fail-fast
  --no-verify
  --force
  --stdin
  --format <yaml|toml|json>
  --json
  --dry-run
  --launch
  --terminal <ghostty|zellij>
  --layout <tabs|splits>
`;
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help" };
  }
  const [command = "help", maybePath, ...rest] = argv;
  const args = maybePath?.startsWith("--") ? [maybePath, ...rest] : rest;
  const options: CliOptions = { command };
  if (maybePath && !maybePath.startsWith("--")) {
    options.matrixPath = maybePath;
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new UserFacingError(`${arg} requires a value.`);
      }
      index += 1;
      return value;
    };
    switch (arg) {
      case "--repo":
        options.repo = next();
        break;
      case "--source":
        options.source = next();
        break;
      case "--backend":
        options.backend = next() as CliOptions["backend"];
        break;
      case "--concurrency":
        options.concurrency = Number(next());
        break;
      case "--state-root":
        options.stateRoot = next();
        break;
      case "--run-id":
        options.runId = next();
        break;
      case "--variant":
        options.variant = next();
        break;
      case "--terminal": {
        const terminal = next();
        if (terminal !== "ghostty" && terminal !== "zellij") {
          throw new UserFacingError(`Unknown terminal: ${terminal}`);
        }
        options.terminal = terminal;
        break;
      }
      case "--layout": {
        const layout = next();
        if (layout !== "tabs" && layout !== "splits") {
          throw new UserFacingError(`Unknown layout: ${layout}`);
        }
        options.layout = layout;
        break;
      }
      case "--format":
        options.format = next() as MatrixFormat;
        break;
      case "--allow-dirty-base":
        options.allowDirtyBase = true;
        break;
      case "--fail-fast":
        options.failFast = true;
        break;
      case "--no-verify":
        options.noVerify = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--stdin":
        options.stdin = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--launch":
        options.launch = true;
        break;
      case "--help":
      case "-h":
        options.command = "help";
        break;
      default:
        throw new UserFacingError(`Unknown option: ${arg}`);
    }
  }
  const isRunCommand = options.command === "run" || options.command === "dry-run";
  if (options.launch && !isRunCommand) {
    throw new UserFacingError("--launch is only supported by run and dry-run.");
  }
  if (options.terminal && options.command === "open" && options.terminal !== "ghostty") {
    throw new UserFacingError("open --terminal only supports ghostty.");
  }
  if (options.terminal && options.command !== "open" && !(isRunCommand && options.launch)) {
    throw new UserFacingError("--terminal is only supported by open or run --launch.");
  }
  if (options.launch && isRunCommand && !options.terminal) {
    throw new UserFacingError("run --launch requires --terminal ghostty|zellij.");
  }
  if (options.layout && !options.terminal) {
    throw new UserFacingError("--layout requires --terminal ghostty|zellij.");
  }
  if (options.layout && options.terminal === "zellij" && options.layout !== "tabs") {
    throw new UserFacingError("zellij launch mode only supports the tabs layout.");
  }
  if (options.layout && options.command === "open" && options.terminal !== "ghostty") {
    throw new UserFacingError("--layout requires --terminal ghostty.");
  }
  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function loadMatrix(options: CliOptions) {
  if (options.stdin) {
    const format = options.format ?? "yaml";
    return parseMatrixText(await readStdin(), format);
  }
  if (!options.matrixPath) {
    throw new UserFacingError("Matrix path is required unless --stdin is set.");
  }
  return readMatrixFile(options.matrixPath);
}

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.command === "help") {
    process.stdout.write(help());
    return 0;
  }
  if (options.command === "schema") {
    process.stdout.write(`${JSON.stringify(MATRIX_SCHEMA, null, 2)}\n`);
    return 0;
  }
  if (options.command === "report") {
    if (!options.matrixPath) {
      throw new UserFacingError("report requires <run-dir>.");
    }
    const report = await regenerateReport(resolve(options.matrixPath));
    process.stdout.write(report);
    return 0;
  }
  if (options.command === "status") {
    if (!options.matrixPath) {
      throw new UserFacingError("status requires <run-dir>.");
    }
    process.stdout.write(await printStatus(resolve(options.matrixPath)));
    return 0;
  }
  if (options.command === "open") {
    if (!options.matrixPath) {
      throw new UserFacingError("open requires <run-dir>.");
    }
    process.stdout.write(
      await printOpenCommand(resolve(options.matrixPath), options.variant, {
        json: options.json,
        terminal: options.terminal,
        layout: options.layout,
        dryRun: options.dryRun,
      }),
    );
    return 0;
  }
  if (options.command === "cleanup") {
    if (!options.matrixPath) {
      throw new UserFacingError("cleanup requires <run-dir>.");
    }
    const result = await cleanupRun(resolve(options.matrixPath), {
      dryRun: options.dryRun,
      force: options.force,
    });
    process.stdout.write(
      options.json ? `${JSON.stringify(result, null, 2)}\n` : renderCleanupResult(result),
    );
    return 0;
  }
  if (options.command !== "run" && options.command !== "dry-run") {
    throw new UserFacingError(`Unknown command: ${options.command}`);
  }
  const parsed = await loadMatrix(options);
  const dry = options.command === "dry-run" || options.dryRun;
  const resolved = await resolveRun(parsed.matrix, parsed.hash, options, dry ? "dry-run" : "run");
  if (options.launch) {
    const launchOptions = {
      terminal: options.terminal ?? "ghostty",
      layout: options.layout,
    };
    if (dry) {
      const output = renderLaunchDryRun(resolved, launchOptions);
      process.stdout.write(
        options.json
          ? `${JSON.stringify(launchDryRunJson(resolved, launchOptions), null, 2)}\n`
          : output,
      );
      return 0;
    }
    const metadata = await launchMatrix(resolved, parsed.hash, launchOptions);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(metadata, null, 2)}\n`
        : `Launch complete: ${resolved.runDir}\n`,
    );
    return 0;
  }
  if (dry) {
    const output = renderDryRun(resolved);
    process.stdout.write(
      options.json ? `${JSON.stringify(dryRunJson(resolved), null, 2)}\n` : output,
    );
    return 0;
  }
  const metadata = await runMatrix(resolved, parsed.hash);
  process.stdout.write(
    options.json ? `${JSON.stringify(metadata, null, 2)}\n` : `Run complete: ${resolved.runDir}\n`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof UserFacingError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`${(error as Error).stack ?? (error as Error).message}\n`);
    }
    process.exitCode = 1;
  },
);
