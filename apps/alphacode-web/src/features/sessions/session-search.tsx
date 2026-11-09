import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { CornerDownLeft, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { searchSessions, type SessionSearchResult } from "@/features/sessions/api";
import type { SessionFolder } from "@/features/sessions/types";
import "./session-search.css";

export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(offset, match.index));
    parts.push(<mark key={match.index} className="rounded-xs bg-foreground/15 px-0.5 font-medium text-foreground">{match[0]}</mark>);
    offset = match.index + match[0].length;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}

interface SessionSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: SessionFolder[];
  onSelectSession: (id: string) => void;
  onCloseFocus: () => void;
}

const roleLabels = { user: "你", assistant: "助手", tool: "工具" };

export function SessionSearch({ open, onOpenChange, folders, onSelectSession, onCloseFocus }: SessionSearchProps) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:duration-150 dark:bg-black/45" />
      <Dialog.Content aria-describedby="session-search-description"
        onCloseAutoFocus={(event) => { event.preventDefault(); onCloseFocus(); }}
        className="fixed top-[max(1rem,10dvh)] left-1/2 z-50 w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 outline-none sm:top-[20dvh] motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95 motion-safe:duration-150">
        <Dialog.Title className="sr-only">搜索会话</Dialog.Title>
        <Dialog.Description id="session-search-description" className="sr-only">搜索所有工作区的会话标题、路径和消息内容。使用上下方向键选择，Enter 打开，Esc 关闭。</Dialog.Description>
        <SearchContent folders={folders} onSelect={(id) => { onOpenChange(false); onSelectSession(id); }} />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function SearchContent({ folders, onSelect }: { folders: SessionFolder[]; onSelect: (id: string) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalized = input.trim();
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => setQuery(normalized), 180);
    return () => clearTimeout(timer);
  }, [normalized, composing]);
  const search = useQuery({
    queryKey: ["session-search", query],
    queryFn: ({ signal }) => searchSessions(query, signal),
    enabled: Boolean(query) && query === normalized && !composing,
    retry: false,
  });
  const waiting = Boolean(normalized) && (query !== normalized || composing || search.isPending);
  const recent: SessionSearchResult[] = folders.flatMap(folder => folder.sessions.filter(session => !session.local).map(session => ({
    session: { id: session.id, title: session.title, workspaceRoot: folder.path, projectId: folder.id, updatedAt: "", status: "" },
    snippets: [], matchCount: 0,
  }))).slice(0, 8);
  const local: SessionSearchResult[] = normalized ? folders.flatMap(folder => folder.sessions.filter(session => session.local &&
    `${session.title}\n${folder.path}`.toLowerCase().includes(normalized.toLowerCase())).map(session => ({
    session: { id: session.id, title: session.title, workspaceRoot: folder.path, projectId: folder.id, updatedAt: "", status: "local" },
    snippets: [], matchCount: 0,
  }))) : [];
  const results = !normalized ? recent : waiting || search.isError ? [] : [...local, ...(search.data ?? [])];

  // Results are already matched against full history by the server. Let cmdk own
  // selection/accessibility without filtering or reordering those results again.
  return <Command label="搜索会话内容" shouldFilter={false} loop vimBindings={false} className="session-search-command">
    <div className="search-input-row">
      <Command.Input ref={inputRef} maxLength={500}
        placeholder="搜索所有会话内容…" value={input}
        onValueChange={setInput}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
      {input && <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="清除搜索" onClick={() => { setInput(""); setQuery(""); inputRef.current?.focus(); }}><X aria-hidden="true" /></Button>}
      <Dialog.Close asChild><Button variant="ghost" size="sm" aria-label="关闭搜索" className="search-close"><kbd>Esc</kbd></Button></Dialog.Close>
    </div>
    <Command.List label="搜索结果" aria-busy={waiting}>
      {waiting ? <Command.Loading label="正在搜索全部会话" className="search-state">正在搜索全部会话…</Command.Loading>
        : <div role="status" aria-live="polite" className="sr-only">
          {search.isError ? "搜索未完成" : `找到 ${results.length} 个会话`}
        </div>}
      {normalized && !waiting && search.isError && <div role="alert" className="search-state space-y-3">
        <p>无法搜索会话，请确认本地服务仍在运行。</p>
        <Button variant="outline" size="sm" onClick={() => void search.refetch()}>重试搜索</Button>
      </div>}
      {!waiting && !search.isError && <Command.Empty>
        <p className="text-sm">{normalized ? "没有找到匹配的会话" : "暂无会话"}</p>
        <p className="mt-2 text-xs text-muted-foreground">{normalized ? "试试其他关键词，也可以搜索消息中的代码或项目路径。" : "开始对话后，可以在这里搜索历史内容。"}</p>
      </Command.Empty>}
      {results.length > 0 && <Command.Group heading={normalized ? `搜索结果 · ${results.length}` : "最近会话"}>
        {results.map((result) => <Command.Item key={result.session.id} value={result.session.id}
          onMouseDown={(event) => event.preventDefault()} onSelect={() => onSelect(result.session.id)}
          data-search-hit={Boolean(normalized)}>
          <MessageSquare className="search-result-icon" aria-hidden="true" />
          <div className="search-result-content">
            <div className="search-result-heading">
              <span className="search-result-title" title={result.session.title}><Highlight text={result.session.title} query={normalized} /></span>
              {!normalized && <span className="search-project" title={result.session.workspaceRoot}>{result.session.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1)}</span>}
              {result.matchCount > 0 && <span className="search-result-count">{result.matchCount} 条匹配</span>}
              {result.session.status === "local" && <span className="search-project">草稿</span>}
            </div>
            {normalized && <p className="search-result-path" title={result.session.workspaceRoot}><Highlight text={result.session.workspaceRoot} query={normalized} /></p>}
            {result.snippets.map(snippet => <p key={snippet.messageId} className="search-result-snippet">
              <span className="mr-1.5">{roleLabels[snippet.role]}:</span><Highlight text={snippet.text} query={normalized} />
            </p>)}
          </div>
          <span className="search-shortcuts search-result-shortcut" aria-hidden="true"><kbd><CornerDownLeft /></kbd></span>
        </Command.Item>)}
      </Command.Group>}
    </Command.List>
  </Command>;
}
