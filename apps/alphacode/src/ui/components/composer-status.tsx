import { useEffect, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { ChatState } from "@alpha/alphacode-app-server/contracts";
import { colors } from "../theme";
import { formatDuration } from "../duration";
import { ShimmerText } from "./shimmer-text";
import { Spinner } from "./spinner";
import { useTranslation } from "../../i18n/react";
import type { Translate } from "../../i18n/instance";
import { presentToolDescription, presentNote } from "../../i18n/presentation";

export function composerActivity(t: Translate, state: ChatState): { text: string; animated: boolean; color: string } {
  if (state.closing) return { text: t("chat:activity.closing"), animated: true, color: colors.muted };
  if (state.connection === "reconnecting") return { text: t("chat:activity.reconnecting"), animated: true, color: colors.muted };
  if (state.phase === "stopping") return { text: t("chat:activity.stopping"), animated: true, color: colors.muted };
  if (state.approval) return { text: t("chat:activity.approval"), animated: false, color: colors.warning };
  if (!state.busy) return { text: state.lastRunStatus ? presentNote(t, { noteCode: state.lastRunStatus }) : t("chat:outcome.completed"), animated: false, color: state.error ? colors.error : colors.muted };
  if (state.contextUsage?.compaction?.status === 'start') return { text: t('chat:activity.compacting'), animated: true, color: colors.muted };
  if (state.phase === "running") {
    const tool = state.messages.findLast(message => message.tool?.status === "running")?.tool;
    return { text: tool ? presentToolDescription(t, tool) : t("chat:activity.working"), animated: true, color: colors.muted };
  }
  if (state.phase === "saving") return { text: t("chat:activity.saving"), animated: true, color: colors.muted };
  if (state.phase === "queued") return { text: t("chat:activity.queued"), animated: true, color: colors.muted };
  const turnStart = state.messages.findLastIndex(message => message.role === "user");
  const hasResults = state.messages.slice(turnStart + 1).some(message => message.tool?.finishedAt !== undefined);
  return { text: hasResults ? t("chat:activity.reviewing") : t("chat:activity.working"), animated: true, color: colors.muted };
}

export function ComposerStatus(props: { state: ChatState }) {
  const { t } = useTranslation();
  const dimensions = useTerminalDimensions();
  const activity = composerActivity(t, props.state);
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
          ({formatDuration(elapsed)}{props.state.busy && dimensions.width >= 48 ? t("chat:interrupt") : ""})
        </text>
      </box>
  );
}
