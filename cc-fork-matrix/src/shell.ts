import { spawn } from "node:child_process";
import type { CommandResult } from "./types.ts";

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs)
        : null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        code: 127,
        signal: null,
        stdout,
        stderr: stderr + error.message,
      });
    });
    child.on("close", (code, signal) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        code: timedOut ? 124 : code,
        signal,
        stdout,
        stderr: timedOut ? `${stderr}\nCommand timed out.` : stderr,
      });
    });
    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

export function runInteractiveCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
    });
    child.on("error", (error) => {
      resolve({
        code: 127,
        signal: null,
        stdout: "",
        stderr: error.message,
      });
    });
    child.on("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout: "",
        stderr: code === 0 ? "" : `${command} exited with code ${code ?? "signal"}.`,
      });
    });
  });
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
