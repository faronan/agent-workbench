export const MATRIX_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "cc-fork-matrix matrix",
  type: "object",
  required: ["version", "name", "variants"],
  properties: {
    version: { const: 1 },
    name: { type: "string", minLength: 1 },
    repo: { type: "string" },
    baseRef: { type: "string" },
    source: {
      type: "object",
      properties: {
        backend: { enum: ["claude-cli", "codex-cli", "claude-agent-sdk"] },
        session: { type: "string" },
      },
    },
    run: {
      type: "object",
      properties: {
        concurrency: { type: "integer", minimum: 1 },
        dirtyBase: { enum: ["stop", "allow"] },
        stateRoot: { type: "string" },
        failFast: { type: "boolean" },
      },
    },
    backend: {
      type: "object",
      properties: {
        claude: {
          type: "object",
          properties: {
            command: { type: "string" },
            mode: { enum: ["print", "background"] },
            permissionMode: { type: "string" },
            maxTurns: { type: "integer", minimum: 1 },
          },
        },
        codex: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
        },
      },
    },
    variants: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["name", "prompt"],
        properties: {
          name: { type: "string", minLength: 1 },
          prompt: { type: "string", minLength: 1 },
          branch: { type: "string" },
          worktree: { type: "string" },
        },
      },
    },
  },
};
