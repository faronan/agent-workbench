export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function assertUser(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new UserFacingError(message);
  }
}
