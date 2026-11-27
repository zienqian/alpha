import { useTranslation } from "@/i18n/react";
import { memo, type ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { Markdown } from "@/components/markdown";
import { MessageAttachments } from "@/components/ai-elements/attachment-list";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import type { ChatAttachment } from "@/features/sessions/api";

// https://ui.shadcn.com/docs/ai-elements/radix/message
export const ChatMessage = memo(function ChatMessage({ role, content, attachments, streaming = false, showCopy = true, actions }: {
  role: "user" | "assistant";
  content: string;
  attachments?: readonly ChatAttachment[];
  streaming?: boolean;
  showCopy?: boolean;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const hasContent = Boolean(content.trim());
  const hasAttachments = Boolean(attachments?.length);
  if (!hasContent && !hasAttachments) return null;
  const isUser = role === "user";
  return (
    <Message align={isUser ? "end" : "start"} className="group/message">
      <MessageContent className="gap-1.5">
        {hasAttachments && attachments && (
          <MessageAttachments attachments={attachments} align={isUser ? "end" : "start"} />
        )}
        {hasContent && (isUser ? (
          <Bubble align="end" variant="muted" className="min-w-0 max-w-[90%] sm:max-w-[82%]">
            <BubbleContent className="rounded-2xl px-4 py-2.5 text-foreground">
              <Markdown className="text-[0.875rem] leading-[1.55]">{content}</Markdown>
            </BubbleContent>
          </Bubble>
        ) : <Markdown>{content}</Markdown>)}
        {(hasContent || actions) && showCopy && !streaming && <MessageFooter className="pointer-events-none gap-0.5 px-0 opacity-0 transition-opacity duration-150 ease-out group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
          {hasContent && <CopyButton value={content} label={isUser ? t("common:copyUser") : t("common:copyReply")} />}
          {actions}
        </MessageFooter>}
      </MessageContent>
    </Message>
  );
});
