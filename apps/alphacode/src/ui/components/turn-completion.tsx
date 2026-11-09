import type { ChatMessage } from "../../chat/contracts";
import { formatDuration } from "../duration";
import { colors } from "../theme";
import { useTranslation } from "../../i18n/react";
import { formatTime } from "../../i18n/format";
import { useLocale } from "../i18n-provider";

export function TurnCompletion(props: { id: string; completion: NonNullable<ChatMessage["completion"]> }) {
  const { t } = useTranslation();
  const { formatLocale } = useLocale();
  const key = props.completion.status === "cancelled" ? "chat:completion.cancelled"
    : props.completion.status === "failed" ? "chat:completion.failed"
    : props.completion.status === "completed" ? "chat:completion.completed" : "chat:completion.other";
  return <text id={`completion-${props.id}`} fg={colors.muted} paddingLeft={3} marginTop={1} height={1} truncate wrapMode="none">
    {t(key, { duration: formatDuration(props.completion.durationMs), time: formatTime(props.completion.completedAt, formatLocale) })}
  </text>;
}
