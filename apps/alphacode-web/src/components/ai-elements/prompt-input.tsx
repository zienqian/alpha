import { useTranslation } from "@/i18n/react";
import { useId, type ReactNode } from "react";
import { ArrowUp, Folder, LaptopMinimal, LoaderCircle, Square, FileText, X } from "lucide-react";
import {
  Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentMedia, AttachmentTitle,
} from "@/components/ui/attachment";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import type { SessionDraft } from "@/features/sessions/use-session-workspace";
import type { SessionFolder } from "@/features/sessions/types";
import type { ContextUsage, PermissionMode } from "@/features/sessions/api";
import { SessionPermissions } from "@/features/sessions/session-permissions";
import { ContextUsageIndicator } from "@/features/sessions/context-usage";
import { MarkdownEditor } from "@/components/ai-elements/markdown-editor";

// https://ui.shadcn.com/docs/ai-elements/radix/prompt-input
// Server owns accepted conversation state; InputGroup + Attachment compose the prompt field.
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
      {(folder || projectPicker) && <div className="composer-context mb-2.5 flex min-w-0 flex-wrap items-center gap-2 px-0.5 text-xs text-muted-foreground">
        {projectPicker ?? (folder && <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-foreground" title={folder.path}>
          <Folder className="size-icon shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate font-medium">{folder.name}</span>
        </span>)}
        <span className="inline-flex shrink-0 items-center gap-1.5 px-1 text-muted-foreground"><LaptopMinimal className="size-icon" aria-hidden="true" />{t("workspace:computer")}</span>
      </div>}
      <InputGroup className="composer composer-surface rounded-2xl bg-clip-padding has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-0">
        {draft.attachments.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap gap-1.5 px-3 pt-3 pb-0">
            {draft.attachments.map(({ id, file }) => (
              <Attachment key={id} size="sm">
                <AttachmentMedia>
                  <FileText aria-hidden="true" />
                </AttachmentMedia>
                <AttachmentContent className="max-w-48">
                  <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={t("sessions:removeAttachment", { name: file.name })}
                    onClick={() => onChange({ attachments: draft.attachments.filter((attachment) => attachment.id !== id) })}
                  >
                    <X aria-hidden="true" />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </InputGroupAddon>
        )}
        <MarkdownEditor value={draft.text} onChange={text => onChange({ text })}
          label={t("sessions:draft")} placeholder={t(busy ? "sessions:queuePlaceholder" : "sessions:placeholder")}
          focusRequest={focusRequest} onSend={onSend} canSend={canSend} />
        <InputGroupAddon align="block-end" className="min-w-0 flex-wrap gap-1.5 px-2.5 pt-1 pb-2.5">
          <SessionPermissions mode={permissionMode} onChange={onPermissionChange} disabled={!canChangePermission}
            saving={permissionSaving} busy={busy || Boolean(submitting)} />
          {showContextUsage && <ContextUsageIndicator usage={contextUsage} />}
          <div className="ms-auto flex min-w-0 items-center gap-1.5">
            <span id={statusId} role="status" className="min-w-0 truncate px-1 text-xs font-normal text-muted-foreground empty:px-0">{submitting ? t("sessions:submitting") : status}</span>
            {busy && <InputGroupButton variant={draft.text.trim() ? "ghost" : "default"} size="icon-sm" className="size-8 shrink-0 rounded-full" disabled={!canCancel} aria-label={t("sessions:stop")} onClick={onCancel}>
              <Square className="size-3.5 fill-current" aria-hidden="true" />
            </InputGroupButton>}
            {(!busy || Boolean(draft.text.trim())) && <InputGroupButton variant="default" size="icon-sm"
              className="size-8 shrink-0 rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
              disabled={!canSend}
              aria-label={t(busy ? "sessions:enqueue" : "sessions:send")} title={t(busy ? "sessions:enqueue" : "sessions:send")} onClick={onSend}>
              {submitting ? <LoaderCircle className="size-icon motion-safe:animate-spin" aria-hidden="true" /> : <ArrowUp className="size-icon" aria-hidden="true" />}
            </InputGroupButton>}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
