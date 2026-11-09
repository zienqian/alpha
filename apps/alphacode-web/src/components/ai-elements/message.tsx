import { useTranslation } from "@/i18n/react";
import { memo } from "react";
import { CopyButton } from "@/components/copy-button";
import { Markdown } from "@/components/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";

// https://ui.shadcn.com/docs/ai-elements/radix/message
export const ChatMessage = memo(function ChatMessage({ role, content, streaming = false, showCopy = true }: {
  role: "user" | "assistant"; content: string; streaming?: boolean; showCopy?: boolean;
}) {
  const { t } = useTranslation();
  if (!content.trim()) return null;
  const isUser = role === "user";
  return (
    <Message align={isUser ? "end" : "start"} className="group/message">
      <MessageContent className="gap-1">
        {isUser ? (
          <Bubble align="end" variant="muted" className="min-w-0 max-w-[90%] rounded-xl sm:max-w-[85%]">
            <BubbleContent className="px-3.5 py-2.5"><Markdown>{content}</Markdown></BubbleContent>
          </Bubble>
        ) : <Markdown>{content}</Markdown>}
        {showCopy && !streaming && <MessageFooter className="pointer-events-none px-0 opacity-0 transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100">
          <CopyButton value={content} label={isUser ? t("common:copyUser") : t("common:copyReply")} />
        </MessageFooter>}
      </MessageContent>
    </Message>
  );
});
