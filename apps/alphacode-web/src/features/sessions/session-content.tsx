import { MessageSquare } from "lucide-react";
import { ChatMessage } from "@/components/ai-elements/message";
import { ReplyProgress } from "@/components/ai-elements/chain-of-thought";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent,
  MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { Session, SessionMessage } from "@/features/sessions/types";
import { ToolActivity } from "@/features/sessions/tool-message";

type HistoryItem = { type: "message"; id: string; message: SessionMessage & { role: "user" | "assistant" } }
  | { type: "tools"; id: string; messages: SessionMessage[] };

export function SessionContent({ session, busy = false, phase, connected = true }: {
  session: Session;
  busy?: boolean;
  phase?: string;
  connected?: boolean;
}) {
  // Tool-only assistant turns have no visible prose. Keep notes and active
  // generation indicators, but do not give empty turns a header or copy row.
  const messages = session.messages.filter((message) => message.role !== "assistant"
    || message.content.trim() || message.note?.trim() || (busy && message.streaming));
  const items: HistoryItem[] = [];
  const finalReplyIds = new Set<string>();
  let lastReplyId: string | undefined;
  for (const message of messages) {
    // Tool steps do not start a new reply. Only the final prose block of each
    // completed user turn gets a copy action; the current turn waits until idle.
    if (message.role === "user") {
      if (lastReplyId) finalReplyIds.add(lastReplyId);
      lastReplyId = undefined;
    } else if (message.role === "assistant" && message.content.trim()) lastReplyId = message.id;
    const previous = items.at(-1);
    if (message.role === "tool") {
      if (previous?.type === "tools") previous.messages.push(message);
      else items.push({ type: "tools", id: message.id, messages: [message] });
    } else items.push({ type: "message", id: message.id, message: { ...message, role: message.role } });
  }
  if (!busy && lastReplyId) finalReplyIds.add(lastReplyId);
  const last = items.at(-1);
  const toolsRunning = last?.type === "tools" && last.messages.some((message) => ["running", "queued", "awaiting_approval"].includes(message.tool?.status ?? ""));
  const streamingReply = last?.type === "message" && last.message.role === "assistant" && last.message.streaming;
  const waiting = busy && !streamingReply && (!toolsRunning || phase === "stopping" || !connected);
  if (messages.length === 0 && !busy) {
    return (
      <Empty role="status">
        <EmptyHeader>
          <EmptyMedia variant="icon"><MessageSquare aria-hidden="true" /></EmptyMedia>
          <EmptyTitle><h2>这个会话还没有消息</h2></EmptyTitle>
          <EmptyDescription>在下方输入消息，开始对话。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport tabIndex={0} aria-label="会话记录">
          <MessageScrollerContent role="list" aria-label="会话消息" className="mx-auto w-full max-w-[744px] gap-4 px-5 py-6 sm:px-8">
            {items.map((item) => (
              <MessageScrollerItem key={item.id} messageId={item.id} role="listitem">
                <article aria-label={item.type === "tools" ? "工具活动" : item.message.role === "user" ? "你的消息" : "AlphaCode 的回复"}>
                  {item.type === "tools" ? <ToolActivity messages={item.messages} active={busy && connected && phase !== "stopping" && item === last} /> : <>
                    {busy && item === last && item.message.role === "assistant" && item.message.streaming && (
                      <div className={item.message.content.trim() ? "mb-2" : undefined}>
                        <ReplyProgress hasContent={Boolean(item.message.content.trim())} phase={phase} connected={connected} />
                      </div>
                    )}
                    <ChatMessage role={item.message.role} content={item.message.content} streaming={busy && item.message.streaming}
                      showCopy={item.message.role === "user" || finalReplyIds.has(item.id)} />
                    {item.message.note && <p className="mt-2 text-xs text-muted-foreground">{item.message.note}</p>}
                  </>}
                </article>
              </MessageScrollerItem>
            ))}
            {waiting && <MessageScrollerItem messageId={`${session.id}-progress`} role="listitem">
              <ReplyProgress phase={phase} connected={connected} />
            </MessageScrollerItem>}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="滚动到底部" className="rounded-full border" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
