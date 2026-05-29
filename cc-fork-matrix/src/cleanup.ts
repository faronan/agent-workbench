import { resolve } from "node:path";
import { UserFacingError } from "./errors.ts";
import { dirtyStatus, pathExists, removeWorktree } from "./git.ts";
import { readMetadata } from "./metadata.ts";

export interface CleanupOptions {
  dryRun?: boolean;
  force?: boolean;
}

export interface CleanupVariantResult {
  name: string;
  slug: string;
  branch: string;
  worktree: string;
  status: "would-remove" | "removed" | "dirty" | "missing";
  dirtyStatus?: string;
}

export interface CleanupResult {
  runDir: string;
  dryRun: boolean;
  force: boolean;
  variants: CleanupVariantResult[];
}

function metadataPath(runDir: string): string {
  return resolve(runDir, "metadata.json");
}

function renderDirtyList(variants: CleanupVariantResult[]): string {
  return variants
    .filter((variant) => variant.status === "dirty")
    .map((variant) => `- ${variant.name}: ${variant.worktree}`)
    .join("\n");
}

export async function cleanupRun(
  runDir: string,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const resolvedRunDir = resolve(runDir);
  const metadata = await readMetadata(metadataPath(resolvedRunDir));
  const variants: CleanupVariantResult[] = [];

  for (const variant of metadata.variants) {
    if (!pathExists(variant.worktree)) {
      variants.push({
        name: variant.name,
        slug: variant.slug,
        branch: variant.branch,
        worktree: variant.worktree,
        status: "missing",
      });
      continue;
    }

    const status = await dirtyStatus(variant.worktree);
    variants.push({
      name: variant.name,
      slug: variant.slug,
      branch: variant.branch,
      worktree: variant.worktree,
      status: status && !options.force ? "dirty" : options.dryRun ? "would-remove" : "removed",
      dirtyStatus: status || undefined,
    });
  }

  const dirtyVariants = variants.filter((variant) => variant.status === "dirty");
  if (dirtyVariants.length > 0) {
    throw new UserFacingError(
      [
        "Refusing to remove dirty worktrees. Re-run with --force to remove them.",
        renderDirtyList(dirtyVariants),
      ].join("\n"),
    );
  }

  if (!options.dryRun) {
    for (const variant of variants) {
      if (variant.status === "removed") {
        await removeWorktree(metadata.repoRoot, variant.worktree, options.force);
      }
    }
  }

  return {
    runDir: resolvedRunDir,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    variants,
  };
}

export function renderCleanupResult(result: CleanupResult): string {
  const lines = [
    `Run dir: ${result.runDir}`,
    `Mode: ${result.dryRun ? "dry-run" : "remove"}`,
    `Force: ${result.force ? "yes" : "no"}`,
    "",
    "Worktrees:",
  ];
  for (const variant of result.variants) {
    lines.push(`- ${variant.name}`);
    lines.push(`  status: ${variant.status}`);
    lines.push(`  branch: ${variant.branch}`);
    lines.push(`  worktree: ${variant.worktree}`);
  }
  return `${lines.join("\n")}\n`;
}
