import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { UserFacingError } from "./errors.ts";
import {
  type GhosttyLaunchOptions,
  type GhosttyOpenTarget,
  launchGhostty,
  renderGhosttyDryRun,
  renderManualCommands,
} from "./ghostty.ts";
import type { GhosttyLayout, RunMetadata, TerminalLauncher, VariantResult } from "./types.ts";

interface OpenOptions {
  json?: boolean;
  terminal?: TerminalLauncher;
  layout?: GhosttyLayout;
  dryRun?: boolean;
  ghostty?: Partial<GhosttyLaunchOptions>;
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

export async function printOpenCommand(
  runDir: string,
  variantName?: string,
  options: OpenOptions = {},
): Promise<string> {
  const metadata = JSON.parse(
    await readFile(resolve(runDir, "metadata.json"), "utf8"),
  ) as RunMetadata;
  const variants = variantName
    ? metadata.variants.filter(
        (variant) => variant.name === variantName || variant.slug === variantName,
      )
    : metadata.variants;
  if (variants.length === 0) {
    throw new UserFacingError(`No variant found for ${variantName ?? "(all)"}.`);
  }
  if (options.terminal && options.json) {
    throw new UserFacingError("--json cannot be combined with --terminal ghostty.");
  }
  if (options.layout && options.terminal !== "ghostty") {
    throw new UserFacingError("--layout requires --terminal ghostty.");
  }
  if (options.dryRun && !options.terminal) {
    throw new UserFacingError("open --dry-run requires --terminal ghostty.");
  }
  if (options.terminal === "ghostty") {
    const layout = options.layout ?? "tabs";
    const targets = ghosttyTargets(variants);
    if (options.dryRun) {
      return renderGhosttyDryRun(targets, layout);
    }
    await launchGhostty(targets, { ...options.ghostty, layout });
    return `Launched Ghostty ${layout} layout for ${targets.length} variant(s).\n`;
  }
  if (options.json) {
    return `${JSON.stringify(variants.map(openPayload), null, 2)}\n`;
  }
  return `${variants.map(openLine).join("\n")}\n`;
}
