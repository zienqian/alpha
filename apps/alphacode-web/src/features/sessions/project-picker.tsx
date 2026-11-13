import { Check, ChevronDown, Folder, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/i18n/react";
import type { SessionFolder } from "./types";

export function ProjectPicker({ folders, selectedId, onSelect, onCreate, disabled }: {
  folders: SessionFolder[]; selectedId?: string; onSelect: (id: string) => void;
  onCreate: () => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const selected = folders.find(folder => folder.id === selectedId);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" disabled={disabled} className="min-w-0 max-w-full gap-2 px-2 font-normal text-muted-foreground"
        aria-label={t("workspace:changeProject")} title={selected?.path}>
        <Folder className="shrink-0" aria-hidden="true" />
        <span className="truncate">{selected?.name ?? t("workspace:selectProject")}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" collisionPadding={12} className="w-72 max-w-[calc(100vw-24px)]">
      {folders.map(folder => <DropdownMenuItem key={folder.id} onSelect={() => onSelect(folder.id)} title={folder.path}>
        <Folder className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1"><span className="block truncate">{folder.name}</span><span className="block truncate text-xs text-muted-foreground">{folder.path}</span></span>
        {folder.id === selectedId && <Check className="shrink-0" aria-label={t("workspace:currentProject")} />}
      </DropdownMenuItem>)}
      {folders.length > 0 && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={onCreate}><Plus aria-hidden="true" />{t("workspace:createProject")}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
