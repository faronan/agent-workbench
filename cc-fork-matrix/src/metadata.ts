import { readFile, writeFile } from "node:fs/promises";
import type { RunMetadata, VariantResult } from "./types.ts";

export function initialMetadata(args: {
  toolVersion: string;
  runId: string;
  name: string;
  repoRoot: string;
  baseRef: string;
  baseHead: string;
  backend: string;
  sourceSession: string;
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
      backend: args.backend as RunMetadata["source"]["backend"],
      session: args.sourceSession,
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
  return JSON.parse(await readFile(path, "utf8")) as RunMetadata;
}

export function upsertVariant(metadata: RunMetadata, variant: VariantResult): void {
  const index = metadata.variants.findIndex((entry) => entry.slug === variant.slug);
  if (index >= 0) {
    metadata.variants[index] = variant;
  } else {
    metadata.variants.push(variant);
  }
}
