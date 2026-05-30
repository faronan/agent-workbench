import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { UserFacingError } from "./errors.ts";
import { branchExists, deleteBranch, dirtyStatus, pathExists, removeWorktree } from "./git.ts";
import { readMetadata } from "./metadata.ts";
import type { VariantResult } from "./types.ts";
import { isAskRunMetadata } from "./types.ts";

export interface CleanupOptions {
  dryRun?: boolean;
  force?: boolean;
  variant?: string;
  exceptVariant?: string;
  deleteBranches?: boolean;
  deleteRunDir?: boolean;
}

export interface CleanupVariantResult {
  name: string;
  slug: string;
  branch: string;
  worktree: string;
  status: "would-remove" | "removed" | "dirty" | "missing";
  branchStatus?: "would-delete" | "deleted" | "missing" | "kept";
  dirtyStatus?: string;
}

export interface CleanupResult {
  runDir: string;
  dryRun: boolean;
  force: boolean;
  deleteBranches: boolean;
  deleteRunDir: boolean;
  selection: {
    variant?: string;
    exceptVariant?: string;
    selectedCount: number;
    totalCount: number;
  };
  runDirStatus?: "would-delete" | "deleted" | "kept";
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

function matchesVariant(variant: VariantResult, selector: string): boolean {
  return variant.name === selector || variant.slug === selector;
}

function selectedVariants(variants: VariantResult[], options: CleanupOptions): VariantResult[] {
  if (options.variant && options.exceptVariant) {
    throw new UserFacingError("--variant and --except cannot be combined.");
  }
  if (options.variant) {
    const selected = variants.filter((variant) => matchesVariant(variant, options.variant ?? ""));
    if (selected.length === 0) {
      throw new UserFacingError(`No variant found for ${options.variant}.`);
    }
    return selected;
  }
  if (options.exceptVariant) {
    if (!variants.some((variant) => matchesVariant(variant, options.exceptVariant ?? ""))) {
      throw new UserFacingError(`No variant found for ${options.exceptVariant}.`);
    }
    return variants.filter((variant) => !matchesVariant(variant, options.exceptVariant ?? ""));
  }
  return variants;
}

async function branchCleanupStatus(args: {
  repoRoot: string;
  branch: string;
  dryRun?: boolean;
  deleteBranches?: boolean;
}): Promise<CleanupVariantResult["branchStatus"]> {
  if (!args.deleteBranches) {
    return "kept";
  }
  if (!(await branchExists(args.repoRoot, args.branch))) {
    return "missing";
  }
  if (args.dryRun) {
    return "would-delete";
  }
  return "would-delete";
}

export async function cleanupRun(
  runDir: string,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const resolvedRunDir = resolve(runDir);
  const metadata = await readMetadata(metadataPath(resolvedRunDir));
  if (isAskRunMetadata(metadata)) {
    throw new UserFacingError(
      "cleanup is not supported for ask runs because they have no worktrees.",
    );
  }
  const targetVariants = selectedVariants(metadata.variants, options);
  if (options.deleteRunDir && targetVariants.length !== metadata.variants.length) {
    throw new UserFacingError("--delete-run-dir requires cleanup of all variants.");
  }
  const variants: CleanupVariantResult[] = [];

  for (const variant of targetVariants) {
    if (!pathExists(variant.worktree)) {
      variants.push({
        name: variant.name,
        slug: variant.slug,
        branch: variant.branch,
        worktree: variant.worktree,
        status: "missing",
        branchStatus: await branchCleanupStatus({
          repoRoot: metadata.repoRoot,
          branch: variant.branch,
          dryRun: options.dryRun,
          deleteBranches: options.deleteBranches,
        }),
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
      branchStatus:
        status && !options.force
          ? "kept"
          : await branchCleanupStatus({
              repoRoot: metadata.repoRoot,
              branch: variant.branch,
              dryRun: options.dryRun,
              deleteBranches: options.deleteBranches,
            }),
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
      if (
        options.deleteBranches &&
        (variant.branchStatus === "would-delete" || variant.branchStatus === undefined)
      ) {
        await deleteBranch(metadata.repoRoot, variant.branch, options.force);
        variant.branchStatus = "deleted";
      }
    }
    if (options.deleteRunDir) {
      await rm(resolvedRunDir, { recursive: true, force: true });
    }
  }

  return {
    runDir: resolvedRunDir,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    deleteBranches: Boolean(options.deleteBranches),
    deleteRunDir: Boolean(options.deleteRunDir),
    selection: {
      variant: options.variant,
      exceptVariant: options.exceptVariant,
      selectedCount: targetVariants.length,
      totalCount: metadata.variants.length,
    },
    runDirStatus: options.deleteRunDir ? (options.dryRun ? "would-delete" : "deleted") : "kept",
    variants,
  };
}

function renderSelection(result: CleanupResult): string {
  const count = `${result.selection.selectedCount}/${result.selection.totalCount}`;
  if (result.selection.variant) {
    return `variant ${result.selection.variant} (${count})`;
  }
  if (result.selection.exceptVariant) {
    return `all except ${result.selection.exceptVariant} (${count})`;
  }
  return `all variants (${count})`;
}

export function renderCleanupResult(result: CleanupResult): string {
  const lines = [
    `Run dir: ${result.runDir}`,
    `Mode: ${result.dryRun ? "dry-run" : "remove"}`,
    `Force: ${result.force ? "yes" : "no"}`,
    `Delete branches: ${result.deleteBranches ? "yes" : "no"}`,
    `Delete run dir: ${result.deleteRunDir ? "yes" : "no"}`,
    `Selection: ${renderSelection(result)}`,
    "",
    "Worktrees:",
  ];
  for (const variant of result.variants) {
    lines.push(`- ${variant.name}`);
    lines.push(`  status: ${variant.status}`);
    lines.push(`  branch: ${variant.branch}`);
    lines.push(`  branchStatus: ${variant.branchStatus ?? "kept"}`);
    lines.push(`  worktree: ${variant.worktree}`);
  }
  lines.push("");
  if (result.dryRun) {
    lines.push("Next:");
    lines.push(`- Review: cc-fork-matrix cleanup ${result.runDir} --dry-run --json`);
    lines.push("- After approval, re-run cleanup without --dry-run using the same selectors.");
  } else {
    lines.push("Next:");
    lines.push(`- Verify: cc-fork-matrix status ${result.runDir}`);
  }
  return `${lines.join("\n")}\n`;
}
