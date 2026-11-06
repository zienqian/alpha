import type { ChatMessage } from "../../chat/contracts";
import { formatDuration } from "../duration";
import { colors } from "../theme";

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export function TurnCompletion(props: { id: string; completion: NonNullable<ChatMessage["completion"]> }) {
  const label = () => props.completion.status === "cancelled" ? "Stopped after"
    : props.completion.status === "failed" ? "Failed after"
    : props.completion.status === "completed" ? "Worked for" : "Ended after";
  return <text id={`completion-${props.id}`} fg={colors.muted} paddingLeft={3} marginTop={1} height={1} truncate wrapMode="none">
    {label()} {formatDuration(props.completion.durationMs)} · {clock.format(props.completion.completedAt)}
  </text>;
}
