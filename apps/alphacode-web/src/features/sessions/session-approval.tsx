import { useTranslation } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import type { SessionView } from "@/features/sessions/api";

export function SessionApproval({ approval, disabled, onAnswer }: {
  approval: NonNullable<SessionView["state"]["approval"]>; disabled: boolean; onAnswer: (allow: boolean) => void;
}) {
  const { t } = useTranslation();
  return <section aria-label={t("tools:approval")} className="mb-3 space-y-2 rounded-lg border p-3 text-xs">
    <p className="font-medium">{t("tools:allow", { toolName: approval.name })}</p>
    {approval.preview.type === "command" && <>
      <p className="break-all text-muted-foreground">{approval.preview.cwd} · {approval.preview.shell}</p>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{approval.preview.command}</pre>
    </>}
    <div className="flex gap-2">
      <Button size="sm" disabled={disabled} onClick={() => onAnswer(true)}>{t("tools:allowOnce")}</Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAnswer(false)}>{t("tools:deny")}</Button>
    </div>
  </section>;
}
