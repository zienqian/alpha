import { ChevronDown, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SessionFolder } from "@/features/sessions/types";

export function WorkspacePicker({ folders, selectedFolder, onSelect }: {
  folders: SessionFolder[]; selectedFolder?: SessionFolder; onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 max-w-52 gap-1.5 px-1 text-xs font-normal text-muted-foreground" disabled={!folders.length} aria-label="选择工作区">
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{selectedFolder?.name ?? "未选择工作区"}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 rounded-lg p-1">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">选择工作区</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={selectedFolder?.id} onValueChange={onSelect}>
          {folders.map((folder) => (
            <DropdownMenuRadioItem key={folder.id} value={folder.id} className="rounded-sm py-1.5 text-[13px]">
              <div className="min-w-0">
                <div className="truncate">{folder.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{folder.path}</div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
