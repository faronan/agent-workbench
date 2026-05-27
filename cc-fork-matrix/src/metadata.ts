import { readFile, writeFile } from "node:fs/promises";
import { assertRunMetadata, invalidMetadata } from "./metadata-contract.ts";
import type { RunMetadata, VariantResult } from "./types.ts";

export function initialMetadata(args: {
  toolVersion: string;
  runId: string;
  name: string;
  repoRoot: string;
  baseRef: string;
  baseHead: string;
  backend: RunMetadata["source"]["backend"];
  sourceSession: string;
  sourceResolvedFrom: RunMetadata["source"]["resolvedFrom"];
  sourceEnv?: RunMetadata["source"]["env"];
  matrixHash: string;
  dirtyBase: boolean;
  dirtyBaseStatus: string;
}): RunMetadata {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    toolVersion: args.toolVersion,
    runId: args.runId,
    name: args.name,
    createdAt: now,
    updatedAt: now,
    repoRoot: args.repoRoot,
    baseRef: args.baseRef,
    baseHead: args.baseHead,
    source: {
      backend: args.backend,
      session: args.sourceSession,
      resolvedFrom: args.sourceResolvedFrom,
      env: args.sourceEnv,
    },
    matrixHash: args.matrixHash,
    dirtyBase: args.dirtyBase,
    dirtyBaseStatus: args.dirtyBaseStatus,
    variants: [],
  };
}

export async function writeMetadata(path: string, metadata: RunMetadata): Promise<void> {
  metadata.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

export async function readMetadata(path: string): Promise<RunMetadata> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      invalidMetadata(`metadata JSON is invalid: ${error.message}`);
    }
    throw error;
  }
  assertRunMetadata(value);
  return value;
}

export function upsertVariant(metadata: RunMetadata, variant: VariantResult): void {
  const index = metadata.variants.findIndex((entry) => entry.slug === variant.slug);
  if (index >= 0) {
    metadata.variants[index] = variant;
  } else {
    metadata.variants.push(variant);
  }
}
