import { UserFacingError } from "./errors.ts";

function parseValue(value: string): unknown {
  const clean = value.trim();
  if (clean === "true") {
    return true;
  }
  if (clean === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(clean)) {
    return Number(clean);
  }
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    return clean.slice(1, -1);
  }
  if (clean.startsWith('"""') && clean.endsWith('"""')) {
    return clean.slice(3, -3);
  }
  return clean;
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}

function setPath(root: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor = root;
  for (const key of path.slice(0, -1)) {
    cursor = ensureObject(cursor, key);
  }
  cursor[path[path.length - 1]] = value;
}

export function parseToml(input: string): unknown {
  const root: Record<string, unknown> = {};
  let section: string[] = [];
  let arrayItem: Record<string, unknown> | null = null;

  const lines = input.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw || raw.startsWith("#")) {
      continue;
    }
    if (raw.startsWith("[[") && raw.endsWith("]]")) {
      section = raw.slice(2, -2).trim().split(".");
      const arrayName = section[section.length - 1];
      let parent = root;
      for (const key of section.slice(0, -1)) {
        parent = ensureObject(parent, key);
      }
      const arr = Array.isArray(parent[arrayName]) ? (parent[arrayName] as unknown[]) : [];
      arrayItem = {};
      arr.push(arrayItem);
      parent[arrayName] = arr;
      continue;
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      section = raw.slice(1, -1).trim().split(".");
      arrayItem = null;
      continue;
    }
    const equals = raw.indexOf("=");
    if (equals < 0) {
      throw new UserFacingError(`Invalid TOML at line ${index + 1}: expected key = value.`);
    }
    const key = raw.slice(0, equals).trim();
    let value = raw.slice(equals + 1).trim();
    if (value.startsWith('"""') && !value.endsWith('"""')) {
      const block = [value.slice(3)];
      index += 1;
      while (index < lines.length && !lines[index].trimEnd().endsWith('"""')) {
        block.push(lines[index]);
        index += 1;
      }
      if (index >= lines.length) {
        throw new UserFacingError("Invalid TOML: unterminated multiline string.");
      }
      block.push(lines[index].trimEnd().slice(0, -3));
      value = `"""${block.join("\n")}"""`;
    }
    if (arrayItem) {
      arrayItem[key] = parseValue(value);
    } else {
      setPath(root, [...section, key], parseValue(value));
    }
  }

  return root;
}
