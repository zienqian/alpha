import { Check, ChevronDown, Folder, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/i18n/react";
import type { SessionFolder } from "./types";

export function ProjectPicker({ folders, selectedId, onSelect, onCreate, disabled }: {
  folders: SessionFolder[]; selectedId?: string; onSelect: (id?: string) => void;
  onCreate: () => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const selected = folders.find(folder => folder.id === selectedId);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" disabled={disabled}
        className="h-7.5 min-w-0 max-w-full gap-1.5 rounded-full border border-border bg-background ps-2.5 pe-2 text-xs font-medium text-foreground hover:bg-muted/70 dark:bg-card dark:hover:bg-accent/60"
        aria-label={t("workspace:changeProject")} title={selected?.path}>
        <Folder className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{selected?.name ?? t("workspace:defaultWorkspace")}</span>
        <ChevronDown className="size-icon shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" collisionPadding={12} className="w-72 max-w-[calc(100vw-24px)]">
      <DropdownMenuItem onSelect={() => onSelect()}>
        <Folder className="shrink-0" aria-hidden="true" />
        <span className="flex-1">{t("workspace:defaultWorkspace")}</span>
        {(!selectedId || selected?.isDefaultWorkspace) && <Check className="shrink-0 text-foreground" aria-label={t("workspace:currentProject")} />}
      </DropdownMenuItem>
      {folders.filter(folder => !folder.isDefaultWorkspace).map(folder => <DropdownMenuItem key={folder.id} onSelect={() => onSelect(folder.id)} title={folder.path}>
        <Folder className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1"><span className="block truncate">{folder.name}</span><span className="block truncate font-mono text-[0.6875rem] text-muted-foreground">{folder.path}</span></span>
        {folder.id === selectedId && <Check className="shrink-0 text-foreground" aria-label={t("workspace:currentProject")} />}
      </DropdownMenuItem>)}
      {folders.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={onCreate}><Plus aria-hidden="true" />{t("workspace:createProject")}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
