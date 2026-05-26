const SECRET_PATTERNS: RegExp[] = [
  /(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN)=\S+/gi,
  /(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redact(value: string): string {
  let output = value;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match) => {
      const index = match.indexOf("=") >= 0 ? match.indexOf("=") : match.indexOf(":");
      if (index <= 0) {
        return "[REDACTED]";
      }
      return `${match.slice(0, index + 1)}[REDACTED]`;
    });
  }
  return output;
}
