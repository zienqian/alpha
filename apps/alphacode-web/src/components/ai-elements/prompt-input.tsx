import { useTranslation } from "@/i18n/react";
import { useEffect, useRef } from "react";
import { ArrowUp, Folder, LaptopMinimal, LoaderCircle, Square, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import type { SessionDraft } from "@/features/sessions/use-session-workspace";
import type { SessionFolder } from "@/features/sessions/types";
import type { PermissionMode } from "@/features/sessions/api";
import { SessionPermissions } from "@/features/sessions/session-permissions";

// AI Elements Prompt Input pattern; the server owns accepted conversation state.
export function PromptInput({ draft, onChange, focusRequest = 0, onSend, canSend, busy, submitting, onCancel, canCancel, status,
  permissionMode, onPermissionChange, canChangePermission, permissionSaving, folder }: {
  draft: SessionDraft; onChange: (patch: Partial<SessionDraft>) => void; focusRequest?: number;
  onSend: () => void; canSend: boolean; busy: boolean; submitting?: boolean;
  onCancel: () => void; canCancel: boolean; status: string;
  permissionMode?: PermissionMode; onPermissionChange: (mode: PermissionMode) => void;
  canChangePermission: boolean; permissionSaving: boolean;
  folder?: Pick<SessionFolder, "name" | "path">;
}) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusRequest > 0) textareaRef.current?.focus();
  }, [focusRequest]);

  return (
    <div className="w-full">
      {folder && <div className="mx-2 -mb-3 flex min-w-0 items-center gap-4 rounded-t-xl bg-muted/60 px-3 pt-2.5 pb-5 text-xs text-muted-foreground sm:mx-3">
        <span className="flex min-w-0 items-center gap-2" title={folder.path}>
          <Folder className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{folder.name}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2"><LaptopMinimal className="size-3.5" aria-hidden="true" />{t("workspace:computer")}</span>
      </div>}
      <InputGroup className="composer rounded-2xl border-input bg-background shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-foreground/50 has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/20 dark:bg-[color-mix(in_oklab,var(--card)_50%,var(--background))]">
        {draft.attachments.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap gap-1.5 px-3 pt-3">
            {draft.attachments.map(({ id, file }) => (
              <div key={id} className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted/30 py-0.5 pr-0.5 pl-2 text-xs font-normal">
                <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="max-w-48 truncate" title={file.name}>{file.name}</span>
                <Button variant="ghost" size="icon-xs" aria-label={t("sessions:removeAttachment", { name: file.name })}
                  onClick={() => onChange({ attachments: draft.attachments.filter((attachment) => attachment.id !== id) })}>
                  <X className="size-3" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </InputGroupAddon>
        )}
        <InputGroupTextarea ref={textareaRef} aria-label={t("sessions:draft")} aria-describedby="composer-status"
          placeholder={t("sessions:placeholder")} value={draft.text}
          onChange={(event) => onChange({ text: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          className="min-h-20 max-h-48 px-4 pt-3.5 pb-2 text-base leading-6 placeholder:text-muted-foreground md:text-sm" />
        <InputGroupAddon align="block-end" className="gap-2 px-2.5 pt-1 pb-2.5">
          <SessionPermissions mode={permissionMode} onChange={onPermissionChange} disabled={!canChangePermission}
            saving={permissionSaving} busy={busy || Boolean(submitting)} />
          <span id="composer-status" role="status" className="ml-auto truncate px-1 text-xs font-normal">{submitting ? t("sessions:submitting") : status}</span>
          {busy ? <InputGroupButton variant="default" size="icon-sm" disabled={!canCancel} aria-label={t("sessions:stop")} onClick={onCancel}>
            <Square className="size-3.5" aria-hidden="true" />
          </InputGroupButton> : <InputGroupButton variant="default" size="icon-sm" disabled={!canSend} aria-label={t("sessions:send")} onClick={onSend}>
            {submitting ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <ArrowUp className="size-3.5" aria-hidden="true" />}
          </InputGroupButton>}
        </InputGroupAddon>
      </InputGroup>
      {draft.attachments.length > 0 && <p className="mt-2 px-1 text-xs text-muted-foreground">{t("sessions:removeBeforeSending")}</p>}
    </div>
  );
}
