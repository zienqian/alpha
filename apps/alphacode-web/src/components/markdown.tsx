import ReactMarkdown from "react-markdown";
import { isValidElement, type ReactNode } from "react";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/copy-button";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn("markdown min-w-0 text-sm leading-6", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer noopener">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-5 max-w-full overflow-x-auto rounded-md border">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const code = isValidElement<{ children?: string; className?: string }>(children) ? children.props : undefined;
  const value = typeof code?.children === "string" ? code.children.replace(/\n$/, "") : "";
  const language = /language-(\S+)/.exec(code?.className ?? "")?.[1] ?? "text";
  const lines = useHighlightedCode(value, language);
  return (
    <CodeBlock className="my-4 rounded-lg text-xs ring-0">
      <CodeBlockHeader className="border-b px-3 py-1.5">
        <CodeBlockTitle className="font-mono text-xs font-normal text-muted-foreground">{language}</CodeBlockTitle>
        <CodeBlockActions><CopyButton value={value} label="复制代码" /></CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="max-h-96 py-3 leading-5">
        {lines.map((line, index) => <CodeBlockLine key={index}>{line}</CodeBlockLine>)}
      </CodeBlockContent>
    </CodeBlock>
  );
}
