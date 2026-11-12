export class ConfigurationError extends Error {
  readonly code?: string;
  readonly params?: Record<string, string | number>;
  constructor(message: string, options?: ErrorOptions & { code?: string; params?: Record<string, string | number> }) {
    super(message, options);
    this.code = options?.code;
    this.params = options?.params;
  }
}

export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "UNEXPECTED_ERROR";
}
