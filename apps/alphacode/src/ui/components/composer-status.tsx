import { useEffect, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { ChatState } from "../../chat/contracts";
import { colors } from "../theme";
import { formatDuration } from "../duration";
import { ShimmerText } from "./shimmer-text";
import { Spinner } from "./spinner";

export function composerActivity(state: ChatState): { text: string; animated: boolean; color: string } {
  if (state.closing) return { text: "Saving and exiting…", animated: true, color: colors.muted };
  if (state.phase === "stopping") return { text: "Stopping…", animated: true, color: colors.muted };
  if (state.approval) return { text: "Waiting for approval", animated: false, color: colors.warning };
  if (!state.busy) return { text: state.status === "Ready" ? "Completed" : state.status, animated: false, color: state.error ? colors.error : colors.muted };
  if (state.phase === "running") return { text: state.status, animated: true, color: colors.muted };
  if (state.phase === "saving") return { text: "Saving session…", animated: true, color: colors.muted };
  if (state.phase === "queued") return { text: "Preparing next step…", animated: true, color: colors.muted };
  const turnStart = state.messages.findLastIndex(message => message.role === "user");
  const hasResults = state.messages.slice(turnStart + 1).some(message => message.tool?.finishedAt !== undefined);
  return { text: hasResults ? "Reviewing results…" : "Working…", animated: true, color: colors.muted };
}

export function ComposerStatus(props: { state: ChatState }) {
  const dimensions = useTerminalDimensions();
  const activity = composerActivity(props.state);
  const busy = props.state.busy || props.state.closing;
  const runStartedAt = props.state.activeRunStartedAt;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const started = runStartedAt ?? performance.now();
    const tick = () => setElapsed(Math.max(0, performance.now() - started));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [busy, runStartedAt]);
  if (!busy) return null;
  return (
      <box id="composer-status" flexDirection="row" flexShrink={0} height={1} gap={1} paddingX={1} marginBottom={1}>
        <Spinner active={activity.animated} color={activity.color} />
        <ShimmerText text={activity.text} animated={activity.animated} color={activity.color} />
        <text id="activity-elapsed" fg={colors.muted} flexShrink={0} height={1}>
          ({formatDuration(elapsed)}{props.state.busy && dimensions.width >= 48 ? " · esc to interrupt" : ""})
        </text>
      </box>
  );
}
