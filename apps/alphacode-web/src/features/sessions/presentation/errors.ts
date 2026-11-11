import type { Translate } from "@/i18n/instance";
import { actionErrorMessage } from "@/features/sessions/api";
import type { SessionActionError } from "@/features/sessions/domain/errors";

export function presentActionError(t: Translate, error: SessionActionError | undefined) {
  if (!error) return undefined;
  if (error.kind === "interrupted") return t("errors:interrupted");
  if (error.kind === "uncertain") return t("errors:retryUncertain");
  if (error.kind === "permission") return t("settings:permissions.saveFailed");
  return actionErrorMessage(t, error.cause);
}
