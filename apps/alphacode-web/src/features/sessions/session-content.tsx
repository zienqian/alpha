import { MessageSquare } from "lucide-react";
import { ChatMessage } from "@/components/ai-elements/message";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent,
  MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { Session } from "@/features/sessions/types";

export function SessionContent({ session }: { session: Session }) {
  if (session.messages.length === 0) {
    return (
      <Empty role="status">
        <EmptyHeader>
          <EmptyMedia variant="icon"><MessageSquare aria-hidden="true" /></EmptyMedia>
          <EmptyTitle><h2>这个会话还没有消息</h2></EmptyTitle>
          <EmptyDescription>从左侧选择其他会话查看记录，也可以在下方写下草稿。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport tabIndex={0} aria-label="会话记录">
          <MessageScrollerContent role="list" aria-label="会话消息" className="mx-auto w-full max-w-[744px] gap-7 px-5 py-6 sm:px-8">
            {session.messages.map((message) => (
              <MessageScrollerItem key={message.id} messageId={message.id} role="listitem">
                <article aria-label={message.role === "user" ? "你的消息" : "AlphaCode 的回复"}>
                  <ChatMessage role={message.role} content={message.content} />
                </article>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="滚动到底部" className="rounded-full border" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
