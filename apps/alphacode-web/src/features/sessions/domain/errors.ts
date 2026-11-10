import { SessionApiError } from "@/features/sessions/api";

export interface SessionActionError {
  cause?: unknown;
  kind?: "interrupted" | "uncertain";
}

export function shouldRetryQuery(failures: number, error: Error) {
  return failures < 1 && !(error instanceof SessionApiError && error.status < 500);
}

export function isUncertainSubmission(error: unknown) {
  // Busy may be a concurrent admission of the same ID. Keep it for retry.
  return !(error instanceof SessionApiError) || error.status >= 500 || error.code === "SESSION_BUSY";
}
