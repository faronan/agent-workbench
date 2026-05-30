import type { ResolvedAskQuestion, ResolvedVariant } from "./types.ts";

export function buildVariantPrompt(variant: ResolvedVariant): string {
  return [
    "You are running as a cc-fork-matrix variant.",
    `Variant: ${variant.name}`,
    `Branch: ${variant.branch}`,
    `Worktree: ${variant.worktree}`,
    "",
    "Rules:",
    "- Work only inside this worktree and branch.",
    "- Do not run git commit, git push, git merge, git rebase, git stash, or destructive cleanup.",
    "- Verification is run by cc-fork-matrix after you finish.",
    "- Do not include secrets in your final response.",
    "",
    "Variant task:",
    variant.prompt,
  ].join("\n");
}

export function buildAskQuestionPrompt(question: ResolvedAskQuestion): string {
  return [
    "You are running as a cc-fork-matrix ask-only advisory fork.",
    `Question: ${question.name}`,
    "",
    "Rules:",
    "- Answer only the question below.",
    "- Do not modify files.",
    "- Do not run tools.",
    "- Do not include secrets in your final response.",
    "- Return a concise final answer summary.",
    "",
    "Question text:",
    question.question,
  ].join("\n");
}
