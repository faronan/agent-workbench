import { existsSync } from "node:fs";
import { UserFacingError } from "./errors.ts";
import { runCommand } from "./shell.ts";
import type { CommandResult } from "./types.ts";

export async function git(cwd: string, args: string[]): Promise<CommandResult> {
  return runCommand("git", args, cwd);
}

export async function gitText(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args);
  if (result.code !== 0) {
    throw new UserFacingError(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function repoRoot(cwd: string): Promise<string> {
  return gitText(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function dirtyStatus(repo: string): Promise<string> {
  return gitText(repo, ["status", "--porcelain"]);
}

export async function currentHead(repo: string): Promise<string> {
  return gitText(repo, ["rev-parse", "HEAD"]);
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  const result = await git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  return result.code === 0;
}

export async function deleteBranch(repo: string, branch: string, force = false): Promise<void> {
  const result = await git(repo, ["branch", force ? "-D" : "-d", branch]);
  if (result.code !== 0) {
    throw new UserFacingError(
      `git branch ${force ? "-D" : "-d"} failed for ${branch}: ${result.stderr.trim()}`,
    );
  }
}

export async function createWorktree(
  repo: string,
  branch: string,
  worktree: string,
  baseRef: string,
): Promise<void> {
  const result = await git(repo, ["worktree", "add", "-b", branch, worktree, baseRef]);
  if (result.code !== 0) {
    throw new UserFacingError(`git worktree add failed for ${branch}: ${result.stderr.trim()}`);
  }
}

export async function removeWorktree(repo: string, worktree: string, force = false): Promise<void> {
  const args = ["worktree", "remove"];
  if (force) {
    args.push("--force");
  }
  args.push(worktree);
  const result = await git(repo, args);
  if (result.code !== 0) {
    throw new UserFacingError(
      `git worktree remove failed for ${worktree}: ${result.stderr.trim()}`,
    );
  }
}

export async function diffPatch(worktree: string): Promise<string> {
  const unstaged = await git(worktree, ["diff", "--binary"]);
  const staged = await git(worktree, ["diff", "--cached", "--binary"]);
  const untracked = await git(worktree, ["ls-files", "--others", "--exclude-standard"]);
  let untrackedPatch = "";
  for (const file of untracked.stdout.split("\n").filter(Boolean)) {
    const patch = await git(worktree, ["diff", "--no-index", "--", "/dev/null", file]);
    if (patch.stdout) {
      untrackedPatch += patch.stdout;
    }
  }
  return `${unstaged.stdout}${staged.stdout}${untrackedPatch}`;
}

export async function diffStat(worktree: string): Promise<string> {
  const [unstaged, staged] = await Promise.all([
    git(worktree, ["diff", "--stat"]),
    git(worktree, ["diff", "--cached", "--stat"]),
  ]);
  return [unstaged.stdout.trim(), staged.stdout.trim()].filter(Boolean).join("\n");
}

export async function changedFiles(worktree: string): Promise<string[]> {
  const unstaged = await git(worktree, ["diff", "--name-only"]);
  const staged = await git(worktree, ["diff", "--cached", "--name-only"]);
  const untracked = await git(worktree, ["ls-files", "--others", "--exclude-standard"]);
  return [
    ...new Set(
      [
        ...unstaged.stdout.split("\n"),
        ...staged.stdout.split("\n"),
        ...untracked.stdout.split("\n"),
      ]
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].sort();
}

export function pathExists(path: string): boolean {
  return existsSync(path);
}
