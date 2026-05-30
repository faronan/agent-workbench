import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { sha256 } from "./crypto.ts";
import { assertUser, UserFacingError } from "./errors.ts";
import { parseToml } from "./simple-toml.ts";
import { parseYaml } from "./simple-yaml.ts";
import type { AskDefinition, MatrixFormat } from "./types.ts";

export interface ParsedAskConfig {
  config: AskDefinition;
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

function assertOptionalBackend(value: unknown): void {
  if (value === undefined) {
    return;
  }
  assertUser(
    value === "claude-cli" || value === "codex-cli" || value === "claude-agent-sdk",
    "source.backend must be claude-cli, codex-cli, or claude-agent-sdk.",
  );
}

function normalizeAsk(value: unknown): AskDefinition {
  assertUser(isRecord(value), "Ask config must be an object.");
  assertUser(value.version === 1, "Ask config version must be 1.");
  assertUser(typeof value.name === "string" && value.name.trim(), "Ask config name is required.");
  assertUser(
    Array.isArray(value.questions) && value.questions.length > 0,
    "questions are required.",
  );

  if (isRecord(value.source)) {
    assertOptionalBackend(value.source.backend);
    if (value.source.session !== undefined) {
      assertUser(typeof value.source.session === "string", "source.session must be a string.");
    }
  }
  if (isRecord(value.ask)) {
    if (value.ask.concurrency !== undefined) {
      assertUser(
        Number.isInteger(value.ask.concurrency) && value.ask.concurrency > 0,
        "ask.concurrency must be a positive integer.",
      );
    }
    if (value.ask.stateRoot !== undefined) {
      assertUser(typeof value.ask.stateRoot === "string", "ask.stateRoot must be a string.");
    }
    if (value.ask.saveAnswers !== undefined) {
      assertUser(typeof value.ask.saveAnswers === "boolean", "ask.saveAnswers must be a boolean.");
    }
    if (value.ask.answerPolicy !== undefined) {
      assertUser(
        value.ask.answerPolicy === "final-summary-only",
        "ask.answerPolicy must be final-summary-only.",
      );
    }
  }

  const questions = value.questions.map((question, index) => {
    assertUser(isRecord(question), `questions[${index}] must be an object.`);
    assertUser(
      typeof question.name === "string" && question.name.trim(),
      `questions[${index}].name is required.`,
    );
    assertUser(
      typeof question.question === "string" && question.question.trim(),
      `questions[${index}].question is required.`,
    );
    return question;
  });

  const config = value as unknown as AskDefinition;
  config.questions = questions as AskDefinition["questions"];
  return config;
}

export function parseAskConfigText(text: string, format: MatrixFormat): ParsedAskConfig {
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
  return { config: normalizeAsk(raw), hash: sha256(text) };
}

export async function readAskConfigFile(path: string): Promise<ParsedAskConfig> {
  const text = await readFile(path, "utf8");
  return parseAskConfigText(text, formatFromPath(path));
}
