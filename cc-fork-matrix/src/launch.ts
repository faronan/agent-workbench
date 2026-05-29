import { type GhosttyLaunchOptions, type GhosttyOpenTarget, launchGhostty } from "./ghostty.ts";
import { backendCommand, commandInvocation } from "./open-command.ts";
import { buildVariantPrompt } from "./prompt.ts";
import type {
  CodexLaunchTarget,
  GhosttyLayout,
  LaunchLayout,
  MatrixDefinition,
  ResolvedRun,
  ResolvedVariant,
  TerminalLauncher,
} from "./types.ts";
import { launchZellijTabs, type ZellijLaunchOptions } from "./zellij.ts";

export interface LaunchMatrixOptions {
  terminal: TerminalLauncher;
  layout?: LaunchLayout;
  ghostty?: Partial<GhosttyLaunchOptions>;
  zellij?: ZellijLaunchOptions;
  launcher?: (
    targets: CodexLaunchTarget[],
    options: { terminal: TerminalLauncher; layout: "tabs" | "splits" },
  ) => Promise<void>;
}

export function normalizedLaunchLayout(
  terminal: TerminalLauncher,
  layout?: LaunchLayout,
): "tabs" | "splits" {
  if (terminal === "zellij") {
    return "tabs";
  }
  return layout ?? "tabs";
}

export function buildCodexLaunchTarget(args: {
  matrix: MatrixDefinition;
  sourceSession: string;
  variant: ResolvedVariant;
}): CodexLaunchTarget {
  const command = backendCommand("codex-cli", args.matrix) ?? "codex";
  const argv = [
    command,
    "fork",
    args.sourceSession,
    buildVariantPrompt(args.variant),
    "-C",
    args.variant.worktree,
  ];
  return {
    name: args.variant.name,
    slug: args.variant.slug,
    branch: args.variant.branch,
    worktree: args.variant.worktree,
    promptSha256: args.variant.promptSha256,
    command: commandInvocation(args.variant.worktree, argv),
  };
}

function launchDryRunVariant(
  variant: ResolvedVariant,
  terminal: TerminalLauncher,
  layout?: LaunchLayout,
): {
  name: string;
  slug: string;
  branch: string;
  worktree: string;
  promptSha256: string;
  launchTarget: {
    terminal: TerminalLauncher;
    layout: "tabs" | "splits";
  };
} {
  return {
    name: variant.name,
    slug: variant.slug,
    branch: variant.branch,
    worktree: variant.worktree,
    promptSha256: variant.promptSha256,
    launchTarget: {
      terminal,
      layout: normalizedLaunchLayout(terminal, layout),
    },
  };
}

export function renderLaunchDryRun(resolved: ResolvedRun, options: LaunchMatrixOptions): string {
  const layout = normalizedLaunchLayout(options.terminal, options.layout);
  const lines = [
    `Run ID: ${resolved.runId}`,
    `Repo: ${resolved.repoRoot}`,
    `Base: ${resolved.baseRef} @ ${resolved.baseHead}`,
    `State root: ${resolved.stateRoot}`,
    `Run dir: ${resolved.runDir}`,
    `Source: ${resolved.backend} ${resolved.sourceSession}`,
    `Dirty base: ${resolved.dirtyBase ? "yes" : "no"}`,
    `Launch target: ${options.terminal} ${layout}`,
    "",
    "Variants:",
  ];
  for (const variant of resolved.variants) {
    lines.push(`- ${variant.name}`);
    lines.push(`  branch: ${variant.branch}`);
    lines.push(`  worktree: ${variant.worktree}`);
    lines.push(`  promptSha256: ${variant.promptSha256}`);
    lines.push(`  launchTarget: ${options.terminal} ${layout}`);
  }
  return `${lines.join("\n")}\n`;
}

export function launchDryRunJson(resolved: ResolvedRun, options: LaunchMatrixOptions): unknown {
  return {
    runId: resolved.runId,
    repoRoot: resolved.repoRoot,
    baseRef: resolved.baseRef,
    baseHead: resolved.baseHead,
    stateRoot: resolved.stateRoot,
    runDir: resolved.runDir,
    source: {
      backend: resolved.backend,
      session: resolved.sourceSession,
      resolvedFrom: resolved.sourceResolvedFrom,
      env: resolved.sourceEnv,
    },
    dirtyBase: resolved.dirtyBase,
    launch: true,
    terminal: options.terminal,
    layout: normalizedLaunchLayout(options.terminal, options.layout),
    variants: resolved.variants.map((variant) =>
      launchDryRunVariant(variant, options.terminal, options.layout),
    ),
  };
}

export async function launchCodexTargets(
  targets: CodexLaunchTarget[],
  options: LaunchMatrixOptions,
): Promise<void> {
  const layout = normalizedLaunchLayout(options.terminal, options.layout);
  if (options.launcher) {
    await options.launcher(targets, { terminal: options.terminal, layout });
    return;
  }
  if (options.terminal === "ghostty") {
    const ghosttyTargets: GhosttyOpenTarget[] = targets.map((target) => ({
      name: target.name,
      slug: target.slug,
      command: target.command,
    }));
    await launchGhostty(ghosttyTargets, {
      ...options.ghostty,
      layout: layout as GhosttyLayout,
    });
    return;
  }
  await launchZellijTabs(targets, options.zellij);
}
