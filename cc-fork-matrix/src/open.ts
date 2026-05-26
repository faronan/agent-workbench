import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { UserFacingError } from "./errors.ts";
import type { RunMetadata, VariantResult } from "./types.ts";

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

export async function printOpenCommand(
  runDir: string,
  variantName?: string,
  options: { json?: boolean } = {},
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
  if (options.json) {
    return `${JSON.stringify(variants.map(openPayload), null, 2)}\n`;
  }
  return `${variants.map(openLine).join("\n")}\n`;
}
