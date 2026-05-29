import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { UserFacingError } from "./errors.ts";
import { repoRoot as findRepoRoot, pathExists } from "./git.ts";
import { readMetadata } from "./metadata.ts";
import type { CliOptions, RunMetadata, VariantStatus } from "./types.ts";

interface LatestPointer {
  schemaVersion: 1;
  runDir: string;
  runId?: string;
  name?: string;
  updatedAt?: string;
  repoRoot?: string;
}

export interface RunDiscoveryOptions {
  repo?: string;
  stateRoot?: string;
}

export interface RunListItem {
  runId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  runDir: string;
  backend: RunMetadata["source"]["backend"];
  terminal?: NonNullable<RunMetadata["launch"]>["terminal"];
  layout?: NonNullable<RunMetadata["launch"]>["layout"];
  statusCounts: Partial<Record<VariantStatus, number>>;
  variants: Array<{
    name: string;
    slug: string;
    status: VariantStatus;
    branch: string;
    worktree: string;
    changedFiles: string[];
  }>;
}

export function defaultGlobalStateRoot(repoRoot: string): string {
  return resolve(repoRoot, "../.cc-fork-matrix");
}

async function resolveRepoRoot(options: RunDiscoveryOptions): Promise<string> {
  return findRepoRoot(resolve(options.repo ?? process.cwd()));
}

function latestPointerPath(stateRoot: string): string {
  return resolve(stateRoot, "latest.json");
}

async function mkdirForFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export async function writeLatestPointers(args: {
  repoRoot: string;
  stateRoot: string;
  runDir: string;
  metadata: RunMetadata;
}): Promise<void> {
  const pointer: LatestPointer = {
    schemaVersion: 1,
    runDir: resolve(args.runDir),
    runId: args.metadata.runId,
    name: args.metadata.name,
    updatedAt: args.metadata.updatedAt,
    repoRoot: args.repoRoot,
  };
  const paths = new Set([
    latestPointerPath(defaultGlobalStateRoot(args.repoRoot)),
    latestPointerPath(resolve(args.stateRoot)),
  ]);
  await Promise.all(
    [...paths].map(async (path) => {
      await mkdirForFile(path);
      await writeFile(path, `${JSON.stringify(pointer, null, 2)}\n`);
    }),
  );
}

async function readLatestPointer(path: string): Promise<LatestPointer | undefined> {
  if (!pathExists(path)) {
    return undefined;
  }
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<LatestPointer>;
    if (value.schemaVersion === 1 && typeof value.runDir === "string") {
      return { schemaVersion: 1, runDir: value.runDir };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function candidateRunDirsFromRunsDir(runsDir: string): Promise<string[]> {
  if (!pathExists(runsDir)) {
    return [];
  }
  const entries = await readdir(runsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(runsDir, entry.name));
}

async function candidateRunDirs(base: string): Promise<string[]> {
  if (!pathExists(base)) {
    return [];
  }
  const direct = await candidateRunDirsFromRunsDir(resolve(base, "runs"));
  const entries = await readdir(base, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => candidateRunDirsFromRunsDir(resolve(base, entry.name, "runs"))),
  );
  return [...direct, ...nested.flat()];
}

async function readRunListItem(runDir: string): Promise<RunListItem | undefined> {
  try {
    const metadata = await readMetadata(resolve(runDir, "metadata.json"));
    const statusCounts: Partial<Record<VariantStatus, number>> = {};
    for (const variant of metadata.variants) {
      statusCounts[variant.status] = (statusCounts[variant.status] ?? 0) + 1;
    }
    return {
      runId: metadata.runId,
      name: metadata.name,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      runDir: await realpath(runDir),
      backend: metadata.source.backend,
      terminal: metadata.launch?.terminal,
      layout: metadata.launch?.layout,
      statusCounts,
      variants: metadata.variants.map((variant) => ({
        name: variant.name,
        slug: variant.slug,
        status: variant.status,
        branch: variant.branch,
        worktree: variant.worktree,
        changedFiles: variant.changedFiles,
      })),
    };
  } catch {
    return undefined;
  }
}

export async function listRuns(options: RunDiscoveryOptions = {}): Promise<RunListItem[]> {
  const repoRoot = await resolveRepoRoot(options);
  const bases = new Set([defaultGlobalStateRoot(repoRoot)]);
  if (options.stateRoot) {
    bases.add(resolve(repoRoot, options.stateRoot));
  }
  const runDirs = new Set((await Promise.all([...bases].map(candidateRunDirs))).flat());
  for (const path of [...bases].map(latestPointerPath)) {
    const pointer = await readLatestPointer(path);
    if (pointer) {
      runDirs.add(resolve(pointer.runDir));
    }
  }
  const runs = (await Promise.all([...runDirs].map((runDir) => readRunListItem(runDir)))).filter(
    (run): run is RunListItem => Boolean(run),
  );
  return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function resolveLastRunDir(options: RunDiscoveryOptions = {}): Promise<string> {
  const repoRoot = await resolveRepoRoot(options);
  const stateRoot = options.stateRoot
    ? resolve(repoRoot, options.stateRoot)
    : defaultGlobalStateRoot(repoRoot);
  for (const path of [
    latestPointerPath(defaultGlobalStateRoot(repoRoot)),
    latestPointerPath(stateRoot),
  ]) {
    const pointer = await readLatestPointer(path);
    if (!pointer) {
      continue;
    }
    const runDir = resolve(pointer.runDir);
    try {
      await readMetadata(resolve(runDir, "metadata.json"));
      return realpath(runDir);
    } catch {
      // Fall back to scan below.
    }
  }
  const runs = await listRuns(options);
  const latest = runs[0];
  if (!latest) {
    throw new UserFacingError("No cc-fork-matrix runs found for --last.");
  }
  return latest.runDir;
}

export async function resolveRunDirFromCli(options: CliOptions): Promise<string> {
  if (options.last) {
    return resolveLastRunDir({ repo: options.repo, stateRoot: options.stateRoot });
  }
  if (!options.matrixPath) {
    throw new UserFacingError(`${options.command} requires <run-dir> or --last.`);
  }
  return resolve(options.matrixPath);
}
