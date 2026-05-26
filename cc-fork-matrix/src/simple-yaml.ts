import { UserFacingError } from "./errors.ts";

interface Line {
  indent: number;
  text: string;
  lineNumber: number;
}

function preprocess(input: string): Line[] {
  const lines: Line[] = [];
  const raw = input.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < raw.length; index += 1) {
    const original = raw[index];
    if (!original.trim() || original.trimStart().startsWith("#")) {
      continue;
    }
    const indent = original.match(/^ */)?.[0].length ?? 0;
    lines.push({ indent, text: original.trimEnd().trimStart(), lineNumber: index + 1 });
  }
  return lines;
}

function stripInlineComment(value: string): string {
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? null : (quote ?? char);
    }
    if (char === "#" && quote === null && /\s/.test(value[index - 1] ?? " ")) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function scalar(value: string): unknown {
  const clean = stripInlineComment(value).trim();
  if (clean === "") {
    return "";
  }
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
  return clean;
}

function parseKeyValue(text: string, lineNumber: number): [string, string] {
  const index = text.indexOf(":");
  if (index < 0) {
    throw new UserFacingError(`Invalid YAML at line ${lineNumber}: expected key: value.`);
  }
  return [text.slice(0, index).trim(), text.slice(index + 1).trimStart()];
}

function collectBlock(lines: Line[], start: number, parentIndent: number): [string, number] {
  const values: string[] = [];
  let index = start;
  let blockIndent: number | null = null;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent <= parentIndent) {
      break;
    }
    blockIndent ??= line.indent;
    values.push(line.text.padStart(line.text.length + Math.max(0, line.indent - blockIndent)));
    index += 1;
  }
  return [values.join("\n").replace(/\n$/, ""), index];
}

function parseNode(lines: Line[], start: number, indent: number): [unknown, number] {
  if (start >= lines.length) {
    return [{}, start];
  }
  if (lines[start].indent < indent) {
    return [{}, start];
  }
  if (lines[start].text.startsWith("- ")) {
    return parseArray(lines, start, indent);
  }
  return parseObject(lines, start, indent);
}

function parseArray(lines: Line[], start: number, indent: number): [unknown[], number] {
  const output: unknown[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent || !line.text.startsWith("- ")) {
      break;
    }
    if (line.indent > indent) {
      throw new UserFacingError(`Invalid YAML at line ${line.lineNumber}: unexpected indent.`);
    }

    const itemText = line.text.slice(2).trimStart();
    if (itemText === "") {
      const [value, next] = parseNode(lines, index + 1, indent + 2);
      output.push(value);
      index = next;
      continue;
    }

    if (itemText.includes(":")) {
      const [key, rawValue] = parseKeyValue(itemText, line.lineNumber);
      const obj: Record<string, unknown> = {};
      if (rawValue === "|") {
        const [block, next] = collectBlock(lines, index + 1, indent + 2);
        obj[key] = block;
        index = next;
      } else if (rawValue === "") {
        const [value, next] = parseNode(lines, index + 1, indent + 2);
        obj[key] = value;
        index = next;
      } else {
        obj[key] = scalar(rawValue);
        index += 1;
      }

      while (index < lines.length && lines[index].indent === indent + 2) {
        const child = lines[index];
        if (child.text.startsWith("- ")) {
          break;
        }
        const [childKey, childRawValue] = parseKeyValue(child.text, child.lineNumber);
        if (childRawValue === "|") {
          const [block, next] = collectBlock(lines, index + 1, indent + 2);
          obj[childKey] = block;
          index = next;
        } else if (childRawValue === "") {
          const [value, next] = parseNode(lines, index + 1, indent + 4);
          obj[childKey] = value;
          index = next;
        } else {
          obj[childKey] = scalar(childRawValue);
          index += 1;
        }
      }
      output.push(obj);
    } else {
      output.push(scalar(itemText));
      index += 1;
    }
  }
  return [output, index];
}

function parseObject(
  lines: Line[],
  start: number,
  indent: number,
): [Record<string, unknown>, number] {
  const output: Record<string, unknown> = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent || line.text.startsWith("- ")) {
      break;
    }
    if (line.indent > indent) {
      throw new UserFacingError(`Invalid YAML at line ${line.lineNumber}: unexpected indent.`);
    }
    const [key, rawValue] = parseKeyValue(line.text, line.lineNumber);
    if (rawValue === "|") {
      const [block, next] = collectBlock(lines, index + 1, indent);
      output[key] = block;
      index = next;
    } else if (rawValue === "") {
      const [value, next] = parseNode(lines, index + 1, indent + 2);
      output[key] = value;
      index = next;
    } else {
      output[key] = scalar(rawValue);
      index += 1;
    }
  }
  return [output, index];
}

export function parseYaml(input: string): unknown {
  const lines = preprocess(input);
  if (lines.length === 0) {
    return {};
  }
  const [value] = parseNode(lines, 0, lines[0].indent);
  return value;
}
