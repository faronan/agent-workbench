import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { UserFacingError } from "./errors.ts";
import type { RunMetadata } from "./types.ts";

export async function printOpenCommand(runDir: string, variantName?: string): Promise<string> {
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
  return `${variants
    .map((variant) => variant.resumeCommand ?? `# ${variant.name}: no session id was captured`)
    .join("\n")}\n`;
}
