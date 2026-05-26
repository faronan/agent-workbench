import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { sha256 } from "./crypto.ts";
import { assertUser, UserFacingError } from "./errors.ts";
import { parseToml } from "./simple-toml.ts";
import { parseYaml } from "./simple-yaml.ts";
import type { MatrixDefinition, MatrixFormat } from "./types.ts";

export interface ParsedMatrix {
  matrix: MatrixDefinition;
  hash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatFromPath(path: string): MatrixFormat {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") {
    return "json";
  }
  if (ext === ".toml") {
    return "toml";
  }
  return "yaml";
}

export function parseMatrixText(text: string, format: MatrixFormat): ParsedMatrix {
  let raw: unknown;
  try {
    raw =
      format === "json" ? JSON.parse(text) : format === "toml" ? parseToml(text) : parseYaml(text);
  } catch (error) {
    if (error instanceof UserFacingError) {
      throw error;
    }
    throw new UserFacingError(`Failed to parse ${format}: ${(error as Error).message}`);
  }
  const matrix = normalizeMatrix(raw);
  return { matrix, hash: sha256(text) };
}

export async function readMatrixFile(path: string): Promise<ParsedMatrix> {
  const text = await readFile(path, "utf8");
  return parseMatrixText(text, formatFromPath(path));
}

export function normalizeMatrix(value: unknown): MatrixDefinition {
  assertUser(isRecord(value), "Matrix must be an object.");
  assertUser(value.version === 1, "Matrix version must be 1.");
  assertUser(typeof value.name === "string" && value.name.trim(), "Matrix name is required.");
  assertUser(Array.isArray(value.variants) && value.variants.length > 0, "variants are required.");

  const variants = value.variants.map((variant, index) => {
    assertUser(isRecord(variant), `variants[${index}] must be an object.`);
    assertUser(
      typeof variant.name === "string" && variant.name.trim(),
      `variants[${index}].name is required.`,
    );
    assertUser(
      typeof variant.prompt === "string" && variant.prompt.trim(),
      `variants[${index}].prompt is required.`,
    );
    return variant;
  });

  const matrix = value as unknown as MatrixDefinition;
  matrix.variants = variants as MatrixDefinition["variants"];
  return matrix;
}
