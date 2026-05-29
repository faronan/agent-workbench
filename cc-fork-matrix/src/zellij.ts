import { UserFacingError } from "./errors.ts";
import { runCommand } from "./shell.ts";
import type { AgentLaunchTarget, CommandResult } from "./types.ts";

export interface ZellijLaunchOptions {
  command?: string;
  executor?: (command: string, args: string[], cwd: string) => Promise<CommandResult>;
}

function zellijArgs(target: AgentLaunchTarget): string[] {
  return [
    "action",
    "new-tab",
    "--cwd",
    target.worktree,
    "--name",
    target.slug,
    "--",
    ...target.command.argv,
  ];
}

export async function launchZellijTabs(
  targets: AgentLaunchTarget[],
  options: ZellijLaunchOptions = {},
): Promise<void> {
  if (targets.length === 0) {
    throw new UserFacingError("No variants are available to launch in Zellij.");
  }
  const command = options.command ?? "zellij";
  const executor = options.executor ?? runCommand;
  for (const target of targets) {
    const result = await executor(command, zellijArgs(target), process.cwd());
    if (result.code !== 0) {
      throw new UserFacingError(
        [
          `Failed to launch Zellij tab for ${target.name}.`,
          result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : "",
          result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
}
