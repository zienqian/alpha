import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import type { ModelActivity } from "./api";

export function SessionRetry({ retry, disabled, onCancel }: {
  retry: NonNullable<ModelActivity["retry"]>;
  disabled: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((retry.nextAttemptAt - now) / 1000));
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-xs leading-relaxed">
    <div className="min-w-0">
      <p role="status" className="font-medium">{t("sessions:modelRetry", { attempt: retry.attempt, max: retry.maxAttempts })}</p>
      <p className="mt-1 text-muted-foreground tabular-nums" aria-live="off">{seconds > 0
        ? t("sessions:modelRetryWait", { seconds }) : t("sessions:modelRetryConnecting")}</p>
    </div>
    <Button size="sm" variant="outline" disabled={disabled} onClick={onCancel}>{t("sessions:stopRetry")}</Button>
  </div>;
}
