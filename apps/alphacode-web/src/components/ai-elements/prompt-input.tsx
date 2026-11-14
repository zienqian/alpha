import { useTranslation } from "@/i18n/react";
import { useId, type ReactNode } from "react";
import { ArrowUp, Folder, LaptopMinimal, LoaderCircle, Square, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import type { SessionDraft } from "@/features/sessions/use-session-workspace";
import type { SessionFolder } from "@/features/sessions/types";
import type { ContextUsage, PermissionMode } from "@/features/sessions/api";
import { SessionPermissions } from "@/features/sessions/session-permissions";
import { ContextUsageIndicator } from "@/features/sessions/context-usage";

import { MarkdownEditor } from "@/components/ai-elements/markdown-editor";

// AI Elements Prompt Input pattern; the server owns accepted conversation state.
export function PromptInput({ draft, onChange, focusRequest = 0, onSend, canSend, busy, submitting, onCancel, canCancel, status,
  permissionMode, onPermissionChange, canChangePermission, permissionSaving, folder, projectPicker, contextUsage, showContextUsage = false }: {
  projectPicker?: ReactNode;
  contextUsage?: ContextUsage;
  showContextUsage?: boolean;
  draft: SessionDraft; onChange: (patch: Partial<SessionDraft>) => void; focusRequest?: number;
  onSend: () => void; canSend: boolean; busy: boolean; submitting?: boolean;
  onCancel: () => void; canCancel: boolean; status: string;
  permissionMode?: PermissionMode; onPermissionChange: (mode: PermissionMode) => void;
  canChangePermission: boolean; permissionSaving: boolean;
  folder?: Pick<SessionFolder, "name" | "path">;
}) {
  const { t } = useTranslation();
  const statusId = useId();
  return (
    <div className="relative z-10 w-full">
      {(folder || projectPicker) && <div className="composer-context mb-3 flex min-w-0 items-center gap-4 px-1 text-xs text-muted-foreground">
        {projectPicker ?? (folder && <span className="flex min-w-0 items-center gap-2" title={folder.path}>
          <Folder className="size-icon shrink-0" aria-hidden="true" /><span className="truncate">{folder.name}</span>
        </span>)}
        <span className="flex shrink-0 items-center gap-2"><LaptopMinimal className="size-icon" aria-hidden="true" />{t("workspace:computer")}</span>
      </div>}
      <InputGroup className="composer rounded-2xl border-input bg-card bg-clip-padding shadow-(--composer-shadow) transition-[border-color,box-shadow] duration-150 ease-out dark:bg-card has-[[data-slot=input-group-control]:focus-visible]:border-ring/60 has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/15">
        {draft.attachments.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap gap-1.5 px-3 pt-3">
            {draft.attachments.map(({ id, file }) => (
              <div key={id} className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted/30 py-0.5 pr-0.5 pl-2 text-xs font-normal">
                <FileText className="size-icon shrink-0" aria-hidden="true" />
                <span className="max-w-48 truncate" title={file.name}>{file.name}</span>
                <Button variant="ghost" size="icon-xs" aria-label={t("sessions:removeAttachment", { name: file.name })}
                  onClick={() => onChange({ attachments: draft.attachments.filter((attachment) => attachment.id !== id) })}>
                  <X className="size-icon" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </InputGroupAddon>
        )}
        <MarkdownEditor value={draft.text} onChange={text => onChange({ text })}
          label={t("sessions:draft")} placeholder={t(busy ? "sessions:queuePlaceholder" : "sessions:placeholder")}
          focusRequest={focusRequest} onSend={onSend} canSend={canSend} />
        <InputGroupAddon align="block-end" className="gap-2 px-2.5 pt-1 pb-2.5">
          <SessionPermissions mode={permissionMode} onChange={onPermissionChange} disabled={!canChangePermission}
            saving={permissionSaving} busy={busy || Boolean(submitting)} />
          {showContextUsage && <ContextUsageIndicator usage={contextUsage} />}
          <span id={statusId} role="status" className="ml-auto min-w-0 truncate px-1 text-xs font-normal">{submitting ? t("sessions:submitting") : status}</span>
          {busy && <InputGroupButton variant={draft.text.trim() ? "ghost" : "default"} size="icon-sm" disabled={!canCancel} aria-label={t("sessions:stop")} onClick={onCancel}>
            <Square className="size-icon" aria-hidden="true" />
          </InputGroupButton>}
          {(!busy || Boolean(draft.text.trim())) && <InputGroupButton variant="default" size="icon-sm" className="rounded-full" disabled={!canSend}
            aria-label={t(busy ? "sessions:enqueue" : "sessions:send")} title={t(busy ? "sessions:enqueue" : "sessions:send")} onClick={onSend}>
            {submitting ? <LoaderCircle className="size-icon motion-safe:animate-spin" aria-hidden="true" /> : <ArrowUp className="size-icon" aria-hidden="true" />}
          </InputGroupButton>}
        </InputGroupAddon>
      </InputGroup>
      {draft.attachments.length > 0 && <p className="mt-2 px-1 text-xs text-muted-foreground">{t("sessions:removeBeforeSending")}</p>}
    </div>
  );
}
