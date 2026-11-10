import { useTranslation } from "@/i18n/react";
import { MessageSquare } from "lucide-react";
import { ChatMessage } from "@/components/ai-elements/message";
import { ReplyProgress } from "@/components/ai-elements/chain-of-thought";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent,
  MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { Session } from "@/features/sessions/types";
import { presentNote, presentLocalResult } from "@/i18n/presentation";
import { ToolActivity } from "@/features/sessions/tool-message";
import { buildSessionHistory } from "@/features/sessions/domain/history";
import { TraceLauncher } from '@/features/traces/trace-launcher';

export function SessionContent({ session, busy = false, phase, connected = true }: {
  session: Session;
  busy?: boolean;
  phase?: string;
  connected?: boolean;
}) {
  const { t } = useTranslation();
  const { items, finalReplyIds, last, streamingReply, showProgress, empty } = buildSessionHistory(session.messages, busy, phase, connected);
  if (empty) {
    return (
      <Empty role="status">
        <EmptyHeader>
          <EmptyMedia variant="icon"><MessageSquare aria-hidden="true" /></EmptyMedia>
          <EmptyTitle><h2>{t("sessions:empty.title")}</h2></EmptyTitle>
          <EmptyDescription>{t("sessions:empty.description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport tabIndex={0} aria-label={t("sessions:history")}>
          <MessageScrollerContent role="list" aria-label={t("sessions:messages")} className="mx-auto w-full max-w-[744px] gap-4 px-5 py-6 sm:px-8">
            {items.map((item) => (
              <MessageScrollerItem key={item.id} messageId={item.id} role="listitem">
                <article aria-label={item.type === "tools" ? t("tools:activity") : item.message.role === "user" ? t("sessions:userMessage") : t("sessions:assistantMessage")}>
                  {item.type === "tools" ? <ToolActivity messages={item.messages} active={busy && connected && phase !== "stopping" && item === last} /> : <>
                    <ChatMessage role={item.message.role} content={item.message.localResult ? presentLocalResult(t, item.message.localResult) : item.message.content} streaming={busy && item.message.streaming}
                      actions={item.message.role==='assistant'&&finalReplyIds.has(item.id)&&!item.message.localResult&&!session.local ? <TraceLauncher sessionId={session.id} replyId={item.id}/> : undefined}
                      showCopy={item.message.role === "user" || finalReplyIds.has(item.id)} />
                    {item.message.note && <p className="mt-2 text-xs text-muted-foreground">{presentNote(t, item.message)}</p>}
                  </>}
                </article>
              </MessageScrollerItem>
            ))}
            {/* Keep every reply phase in the same trailing row, after prose and notes. */}
            {showProgress && <MessageScrollerItem key="reply-progress" messageId={`${session.id}-progress`} role="listitem">
              <ReplyProgress hasContent={streamingReply} phase={phase} connected={connected} />
            </MessageScrollerItem>}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label={t("sessions:scrollBottom")} className="rounded-full border" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
