import { UserFacingError } from "./errors.ts";
import type { VerificationCommand } from "./types.ts";

const FORBIDDEN_PATTERNS = [
  /\bgit\s+commit\b/,
  /\bgit\s+push\b/,
  /\bgit\s+merge\b/,
  /\bgit\s+rebase\b/,
  /\bgit\s+stash\b/,
  /\brm\s+-rf\b/,
];

export function assertSafeVerificationCommands(commands: VerificationCommand[]): void {
  for (const command of commands) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(command.command)) {
        throw new UserFacingError(
          `Verification command "${command.name}" is forbidden: ${command.command}`,
        );
      }
    }
  }
}
