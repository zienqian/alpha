import { useTranslation } from "@/i18n/react";
import { useEffect, useRef, type ReactNode } from "react";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { exitTransition, surfaceMotion, surfaceTransition } from "@/lib/motion";
import { CornerDownLeft, MessageSquare, X } from "lucide-react";
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
  onCloseFocus: () => void;
}

const roleLabels = { user: "sessions:role.user", assistant: "sessions:role.assistant", tool: "sessions:role.tool" } as const;

export function SessionSearch({ open, onOpenChange, folders, onSelectSession, onCloseFocus }: SessionSearchProps) {
  const { t } = useTranslation();
  // Presence retains the exiting subtree; restore focus using current sidebar state.
  const closeFocusRef = useRef(onCloseFocus);
  useEffect(() => { closeFocusRef.current = onCloseFocus; }, [onCloseFocus]);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <AnimatePresence>
    {open && <Dialog.Portal forceMount>
      <Dialog.Overlay asChild forceMount>
        <m.div className="fixed inset-0 z-50 bg-black/20 dark:bg-black/45"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: exitTransition }} transition={surfaceTransition} />
      </Dialog.Overlay>
      <Dialog.Content asChild forceMount aria-describedby="session-search-description"
        onCloseAutoFocus={(event) => { event.preventDefault(); closeFocusRef.current(); }}
        className="fixed top-[max(1rem,10dvh)] left-1/2 z-50 w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 outline-none sm:top-[20dvh]">
        <m.div {...surfaceMotion}>
        <Dialog.Title className="sr-only">{t("sessions:search")}</Dialog.Title>
        <Dialog.Description id="session-search-description" className="sr-only">{t("sessions:searchDescription")}</Dialog.Description>
        <SearchContent folders={folders} onSelect={(id) => { onOpenChange(false); onSelectSession(id); }} />
        </m.div>
      </Dialog.Content>
    </Dialog.Portal>}
    </AnimatePresence>
  </Dialog.Root>;
}

function SearchContent({ folders, onSelect }: { folders: SessionFolder[]; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const { input, setInput, normalized, setComposing, waiting, results, search, clear } = useSessionSearch(folders);
  const inputRef = useRef<HTMLInputElement>(null);

  // Results are already matched against full history by the server. Let cmdk own
  // selection/accessibility without filtering or reordering those results again.
  return <Command label={t("sessions:searchContent")} shouldFilter={false} loop vimBindings={false} className="session-search-command">
    <div className="search-input-row">
      <Command.Input ref={inputRef} maxLength={500}
        placeholder={t("sessions:searchPlaceholder")} value={input}
        onValueChange={setInput}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
      {input && <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("sessions:clearSearch")} onClick={() => { clear(); inputRef.current?.focus(); }}><X aria-hidden="true" /></Button>}
      {/* i18next-instrument-ignore-next-line — Physical keyboard key. */}
      <Dialog.Close asChild><Button variant="ghost" size="sm" aria-label={t("sessions:closeSearch")} className="search-close"><kbd>Esc</kbd></Button></Dialog.Close>
    </div>
    <Command.List label={t("sessions:searchResults")} aria-busy={waiting}>
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
          <MessageSquare className="search-result-icon" aria-hidden="true" />
          <div className="search-result-content">
            <div className="search-result-heading">
              <span className="search-result-title" title={result.session.title.trim() || t("sessions:new")}><Highlight text={result.session.title.trim() || t("sessions:new")} query={normalized} /></span>
              {!normalized && <span className="search-project" title={result.session.workspaceRoot}>{result.session.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1)}</span>}
              {result.matchCount > 0 && <span className="search-result-count">{t("sessions:matchCount", { count: result.matchCount })}</span>}
              {result.session.status === "local" && <span className="search-project">{t("sessions:draftBadge")}</span>}
            </div>
            {normalized && <p className="search-result-path" title={result.session.workspaceRoot}><Highlight text={result.session.workspaceRoot} query={normalized} /></p>}
            {result.snippets.map(snippet => <p key={snippet.messageId} className="search-result-snippet">
              <span className="mr-1.5">{t(roleLabels[snippet.role])}:</span><Highlight text={snippet.text} query={normalized} />
            </p>)}
          </div>
          <span className="search-shortcuts search-result-shortcut" aria-hidden="true"><kbd><CornerDownLeft /></kbd></span>
        </Command.Item>)}
      </Command.Group>}
    </Command.List>
  </Command>;
}
