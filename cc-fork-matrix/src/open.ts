import { resolve } from "node:path";
import { UserFacingError } from "./errors.ts";
import {
  type GhosttyLaunchOptions,
  type GhosttyOpenTarget,
  launchGhostty,
  renderGhosttyDryRun,
  renderManualCommands,
} from "./ghostty.ts";
import { readMetadata } from "./metadata.ts";
import type { GhosttyLayout, LaunchLayout, TerminalLauncher, VariantResult } from "./types.ts";
import { isAskRunMetadata } from "./types.ts";
import {
  launchZellijWorkspace,
  renderZellijOpenDryRun,
  type ZellijOpenTab,
  type ZellijWorkspaceOptions,
  type ZellijWorkspacePlan,
  zellijOpenDryRunJson,
  zellijSessionName,
} from "./zellij.ts";

interface OpenOptions {
  json?: boolean;
  terminal?: TerminalLauncher;
  layout?: LaunchLayout;
  dryRun?: boolean;
  ghostty?: Partial<GhosttyLaunchOptions>;
  zellij?: ZellijWorkspaceOptions;
}

function openLine(variant: VariantResult): string {
  if (variant.openCommand.kind === "unavailable") {
    return `# ${variant.name}: ${variant.openCommand.sessionIdUnavailableReason}`;
  }
  return variant.openCommand.command.shellCommand;
}

function openPayload(variant: VariantResult) {
  return {
    name: variant.name,
    slug: variant.slug,
    openCommand: variant.openCommand,
  };
}

function ghosttyTargets(variants: VariantResult[]): GhosttyOpenTarget[] {
  const unavailable = variants.filter((variant) => variant.openCommand.kind === "unavailable");
  if (unavailable.length > 0) {
    const available = variants
      .filter((variant) => variant.openCommand.kind !== "unavailable")
      .map((variant) => ({
        name: variant.name,
        slug: variant.slug,
        command: variant.openCommand.command,
      }));
    const manual =
      available.length > 0 ? `\n\nManual commands:\n${renderManualCommands(available)}` : "";
    throw new UserFacingError(
      `Cannot open all selected variants in Ghostty:\n${unavailable
        .map((variant) => `- ${variant.name}: ${variant.openCommand.sessionIdUnavailableReason}`)
        .join("\n")}${manual}`,
    );
  }
  return variants.map((variant) => ({
    name: variant.name,
    slug: variant.slug,
    command: variant.openCommand.command,
  }));
}

function zellijPlan(runId: string, runDir: string, variants: VariantResult[]): ZellijWorkspacePlan {
  const unavailable = variants.filter((variant) => variant.openCommand.kind === "unavailable");
  if (unavailable.length > 0) {
    throw new UserFacingError(
      `Cannot open all selected variants in Zellij:\n${unavailable
        .map((variant) => `- ${variant.name}: ${variant.openCommand.sessionIdUnavailableReason}`)
        .join("\n")}`,
    );
  }
  const tabs: ZellijOpenTab[] = variants.map((variant) => ({
    name: variant.name,
    slug: variant.slug,
    cwd: variant.openCommand.command.cwd,
    commandKind: variant.openCommand.kind,
    backend: variant.openCommand.backend,
    command: variant.openCommand.command,
  }));
  return {
    sessionName: zellijSessionName(runId),
    runDir,
    layout: "tabs",
    tabs,
  };
}

export async function printOpenCommand(
  runDir: string,
  variantName?: string,
  options: OpenOptions = {},
): Promise<string> {
  const metadata = await readMetadata(resolve(runDir, "metadata.json"));
  if (isAskRunMetadata(metadata)) {
    throw new UserFacingError("open is not supported for ask runs. Use status or report instead.");
  }
  if (options.terminal === "zellij" && variantName) {
    throw new UserFacingError(
      "open --terminal zellij opens the full run and cannot be combined with --variant.",
    );
  }
  const variants = variantName
    ? metadata.variants.filter(
        (variant) => variant.name === variantName || variant.slug === variantName,
      )
    : metadata.variants;
  if (variants.length === 0) {
    throw new UserFacingError(`No variant found for ${variantName ?? "(all)"}.`);
  }
  if (options.terminal === "ghostty" && options.json) {
    throw new UserFacingError("--json cannot be combined with --terminal ghostty.");
  }
  if (options.terminal === "zellij" && options.json && !options.dryRun) {
    throw new UserFacingError(
      "--json can only be combined with --terminal zellij when --dry-run is set.",
    );
  }
  if (options.terminal && options.terminal !== "ghostty" && options.terminal !== "zellij") {
    throw new UserFacingError("open --terminal only supports ghostty or zellij.");
  }
  if (options.layout && !options.terminal) {
    throw new UserFacingError("--layout requires --terminal ghostty|zellij.");
  }
  if (options.terminal === "zellij" && options.layout && options.layout !== "tabs") {
    throw new UserFacingError("zellij open mode only supports the tabs layout.");
  }
  if (options.dryRun && !options.terminal) {
    throw new UserFacingError("open --dry-run requires --terminal ghostty|zellij.");
  }
  if (options.terminal === "ghostty") {
    const layout = (options.layout ?? "tabs") as GhosttyLayout;
    const targets = ghosttyTargets(variants);
    if (options.dryRun) {
      return renderGhosttyDryRun(targets, layout);
    }
    await launchGhostty(targets, { ...options.ghostty, layout });
    return `Launched Ghostty ${layout} layout for ${targets.length} variant(s).\n`;
  }
  if (options.terminal === "zellij") {
    const plan = zellijPlan(metadata.runId, resolve(runDir), variants);
    if (options.dryRun) {
      if (options.json) {
        return `${JSON.stringify(zellijOpenDryRunJson(plan), null, 2)}\n`;
      }
      return renderZellijOpenDryRun(plan);
    }
    await launchZellijWorkspace(plan, options.zellij);
    return `Opened Zellij session ${plan.sessionName} for ${plan.tabs.length} variant(s).\n`;
  }
  if (options.json) {
    return `${JSON.stringify(variants.map(openPayload), null, 2)}\n`;
  }
  return `${variants.map(openLine).join("\n")}\n`;
}
