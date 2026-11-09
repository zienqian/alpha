import { Terminal } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Markdown } from "@/components/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message";

// https://ui.shadcn.com/docs/ai-elements/radix/message
export function ChatMessage({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <Message align={isUser ? "end" : "start"} className="group/message">
      <MessageContent>
        {isUser ? (
          <Bubble align="end" variant="muted" className="max-w-[90%] rounded-xl sm:max-w-[85%]">
            <BubbleContent className="px-3.5 py-2.5"><Markdown>{content}</Markdown></BubbleContent>
          </Bubble>
        ) : (
          <>
            <MessageHeader className="gap-1.5 px-0 text-xs font-medium text-foreground">
              <Terminal className="size-3.5" aria-hidden="true" />AlphaCode
            </MessageHeader>
            <Markdown>{content}</Markdown>
          </>
        )}
        <MessageFooter className="px-0 opacity-100 transition-opacity md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100"><CopyButton value={content} label={isUser ? "复制你的消息" : "复制回复"} /></MessageFooter>
      </MessageContent>
    </Message>
  );
}
