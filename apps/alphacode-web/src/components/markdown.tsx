import { useTranslation } from "@/i18n/react";
import ReactMarkdown, { type Components } from "react-markdown";
import { isValidElement, type ReactNode } from "react";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/copy-button";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { cn } from "@/lib/utils";
import { markdownURL } from "@/lib/file-links";
import { MarkdownLink } from "@/components/local-file-links";

interface MarkdownProps {
  children: string;
  className?: string;
}

// Stable component identities preserve code highlighting and selection as tokens arrive.
const markdownComponents: Components = {
  a: MarkdownLink,
  table: ({ children }) => <div className="my-5 max-w-full overflow-x-auto rounded-xl border border-border bg-card"><table>{children}</table></div>,
  pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
};

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn("markdown min-w-0 text-[0.9375rem] leading-[1.62]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={markdownURL}
        components={markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const code = isValidElement<{ children?: string; className?: string }>(children) ? children.props : undefined;
  const value = typeof code?.children === "string" ? code.children.replace(/\n$/, "") : "";
  const language = /language-(\S+)/.exec(code?.className ?? "")?.[1] ?? "text";
  const lines = useHighlightedCode(value, language);
  return (
    <CodeBlock className="my-4 rounded-xl text-[0.8125rem]">
      <CodeBlockHeader className="border-b border-border/60 px-3.5 py-2">
        <CodeBlockTitle className="font-mono text-xs font-normal text-muted-foreground">{language}</CodeBlockTitle>
        <CodeBlockActions><CopyButton value={value} label={t("common:copyCode")} /></CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="max-h-96 px-3.5 py-3 leading-[1.55]">
        {lines.map((line, index) => <CodeBlockLine key={index}>{line}</CodeBlockLine>)}
      </CodeBlockContent>
    </CodeBlock>
  );
}
