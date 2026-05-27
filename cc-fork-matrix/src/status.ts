import { resolve } from "node:path";
import { readMetadata } from "./metadata.ts";

export async function printStatus(runDir: string): Promise<string> {
  const metadata = await readMetadata(resolve(runDir, "metadata.json"));
  return `${JSON.stringify(metadata, null, 2)}\n`;
}
