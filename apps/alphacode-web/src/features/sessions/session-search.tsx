import { useTranslation } from "@/i18n/react";
import { useEffect, useRef, type ReactNode } from "react";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { exitTransition, surfaceMotion, surfaceTransition } from "@/lib/motion";
import { FolderOpen, MessageCircle, Search, SquarePen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSessionSearch } from "@/features/sessions/application/use-session-search";
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
  onNewSession: () => void;
  onOpenFolder: () => void;
  onCloseFocus: () => void;
}

const roleLabels = { user: "sessions:role.user", assistant: "sessions:role.assistant", tool: "sessions:role.tool" } as const;

export function SessionSearch({ open, onOpenChange, folders, onSelectSession, onNewSession, onOpenFolder, onCloseFocus }: SessionSearchProps) {
  const { t } = useTranslation();
  // Presence retains the exiting subtree; restore focus using current sidebar state.
  const closeFocusRef = useRef(onCloseFocus);
  const pendingActionRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { closeFocusRef.current = onCloseFocus; }, [onCloseFocus]);
  useEffect(() => { if (open) pendingActionRef.current = undefined; }, [open]);
  function runAfterClose(action: () => void) {
    pendingActionRef.current = action;
    onOpenChange(false);
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <AnimatePresence>
    {open && <Dialog.Portal forceMount>
      <Dialog.Overlay asChild forceMount>
        <m.div className="fixed inset-0 z-50 bg-black/20 dark:bg-black/45"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: exitTransition }} transition={surfaceTransition} />
      </Dialog.Overlay>
      <Dialog.Content asChild forceMount aria-describedby="session-search-description"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const action = pendingActionRef.current;
          pendingActionRef.current = undefined;
          // Let the outgoing focus trap unmount before opening another dialog or composer.
          if (action) action();
          else closeFocusRef.current();
        }}
        className="fixed top-[max(1rem,10dvh)] left-1/2 z-50 w-[calc(100%-2rem)] max-w-[760px] -translate-x-1/2 outline-none sm:top-[20dvh]">
        <m.div {...surfaceMotion}>
        <Dialog.Title className="sr-only">{t("sessions:search")}</Dialog.Title>
        <Dialog.Description id="session-search-description" className="sr-only">{t("sessions:searchDescription")}</Dialog.Description>
        <SearchContent folders={folders} onSelect={(id) => { onOpenChange(false); onSelectSession(id); }}
          onNewSession={() => runAfterClose(onNewSession)} onOpenFolder={() => runAfterClose(onOpenFolder)} />
        </m.div>
      </Dialog.Content>
    </Dialog.Portal>}
    </AnimatePresence>
  </Dialog.Root>;
}

function SearchContent({ folders, onSelect, onNewSession, onOpenFolder }: {
  folders: SessionFolder[]; onSelect: (id: string) => void; onNewSession: () => void; onOpenFolder: () => void;
}) {
  const { t } = useTranslation();
  const { input, setInput, normalized, setComposing, waiting, results, search, clear } = useSessionSearch(folders);
  const inputRef = useRef<HTMLInputElement>(null);
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const actions = [
    { id: "new-chat", label: t("sessions:searchNewChat"), icon: SquarePen, key: "N", onSelect: onNewSession },
    { id: "open-folder", label: t("sessions:searchOpenFolder"), icon: FolderOpen, key: "O", onSelect: onOpenFolder },
  ];
  const visibleActions = actions.filter(action => !normalized || action.label.toLocaleLowerCase().includes(normalized.toLocaleLowerCase()));

  // Results are already matched against full history by the server. Let cmdk own
  // selection/accessibility without filtering or reordering those results again.
  return <Command label={t("sessions:searchContent")} shouldFilter={false} loop vimBindings={false} className="session-search-command"
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return;
      const action = actions.find(item => item.key.toLowerCase() === event.key.toLowerCase());
      if (action) { event.preventDefault(); action.onSelect(); }
    }}>
    <div className="search-input-row">
      <Search className="search-input-icon" aria-hidden="true" />
      <Command.Input ref={inputRef} maxLength={500}
        placeholder={t("sessions:searchPlaceholder")} value={input}
        onValueChange={setInput}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
      {input && <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("sessions:clearSearch")} onClick={() => { clear(); inputRef.current?.focus(); }}><X aria-hidden="true" /></Button>}
      {/* i18next-instrument-ignore-next-line — Physical keyboard key. */}
      <Dialog.Close asChild><Button variant="ghost" size="sm" aria-label={t("sessions:closeSearch")} className="search-close"><kbd>Esc</kbd></Button></Dialog.Close>
    </div>
    <Command.List label={t("sessions:searchResults")} aria-busy={waiting}>
      {visibleActions.length > 0 && <Command.Group heading={t("sessions:quickActions")}>
        {visibleActions.map(action => <Command.Item key={action.id} value={`action:${action.id}`}
          onMouseDown={(event) => event.preventDefault()} onSelect={action.onSelect}>
          <action.icon className="search-result-icon" aria-hidden="true" />
          <span className="search-result-title">{action.label}</span>
          <kbd className="search-action-shortcut" aria-hidden="true">{modifier}{action.key}</kbd>
        </Command.Item>)}
      </Command.Group>}
      {waiting ? <Command.Loading label={t("sessions:searchingLabel")} className="search-state">{t("sessions:searching")}</Command.Loading>
        : <div role="status" aria-live="polite" className="sr-only">
          {search.isError ? t("sessions:searchIncomplete") : t("sessions:found", { count: results.length })}
        </div>}
      {normalized && !waiting && search.isError && <div role="alert" className="search-state space-y-3">
        <p>{t("errors:search")}</p>
        <Button variant="outline" size="sm" onClick={() => void search.refetch()}>{t("sessions:retrySearch")}</Button>
      </div>}
      {!waiting && !search.isError && <Command.Empty>
        <p className="text-sm">{normalized ? t("sessions:noMatches") : t("sessions:none")}</p>
        <p className="mt-2 text-xs text-muted-foreground">{normalized ? t("sessions:searchSuggestion") : t("sessions:searchEmpty")}</p>
      </Command.Empty>}
      {results.length > 0 && <Command.Group heading={normalized ? t("sessions:resultCount", { count: results.length }) : t("sessions:recent")}>
        {results.map((result) => <Command.Item key={result.session.id} value={result.session.id}
          onMouseDown={(event) => event.preventDefault()} onSelect={() => onSelect(result.session.id)}
          data-search-hit={Boolean(normalized)}>
          <MessageCircle className="search-result-icon" aria-hidden="true" />
          <div className="search-result-content">
            <div className="search-result-heading">
              <span className="search-result-title" title={result.session.title.trim() || t("sessions:new")}><Highlight text={result.session.title.trim() || t("sessions:new")} query={normalized} /></span>
              <span className="search-project" title={result.session.workspaceRoot}>{folders.find(folder => folder.path === result.session.workspaceRoot)?.name ?? result.session.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1)}</span>
              {result.matchCount > 0 && <span className="search-result-count">{t("sessions:matchCount", { count: result.matchCount })}</span>}
              {result.session.status === "local" && <span className="search-project">{t("sessions:draftBadge")}</span>}
            </div>
            {normalized && <p className="search-result-path" title={result.session.workspaceRoot}><Highlight text={result.session.workspaceRoot} query={normalized} /></p>}
            {result.snippets.map(snippet => <p key={snippet.messageId} className="search-result-snippet">
              <span className="mr-1.5">{t(roleLabels[snippet.role])}:</span><Highlight text={snippet.text} query={normalized} />
            </p>)}
          </div>
        </Command.Item>)}
      </Command.Group>}
    </Command.List>
  </Command>;
}
