import { createContext, useContext, useMemo, type ReactNode } from "react";
import { isLocalFileLink, isArtifactLink, sessionDocumentURL } from "@/lib/file-links";

const FileContext = createContext<{ sessionId: string; replyId?: string } | undefined>(undefined);

export function LocalFileLinks({ sessionId, replyId, children }: { sessionId: string; replyId?: string; children: ReactNode }) {
  const value = useMemo(() => ({ sessionId, replyId }), [sessionId, replyId]);
  return <FileContext.Provider value={value}>{children}</FileContext.Provider>;
}

export function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const files = useContext(FileContext);
  if (!href) return <span>{children}</span>;
  if (isLocalFileLink(href) || isArtifactLink(href)) {
    if (!files) return <span title={href}>{children}</span>;
    return <a href={sessionDocumentURL(files.sessionId, href, "open", files.replyId)} title={href} target="_blank" rel="noreferrer noopener">{children}</a>;
  }
  return <a href={href} target={/^(https?:)?\/\//i.test(href) ? "_blank" : undefined} rel="noreferrer noopener">{children}</a>;
}
