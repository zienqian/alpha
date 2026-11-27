import { useTranslation } from "@/i18n/react";
import { useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { ArrowUp, Folder, LaptopMinimal, LoaderCircle, Paperclip, Square, Upload } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import type { SessionDraft } from "@/features/sessions/use-session-workspace";
import type { SessionFolder } from "@/features/sessions/types";
import type { ContextUsage, PermissionMode } from "@/features/sessions/api";
import { SessionPermissions } from "@/features/sessions/session-permissions";
import { ContextUsageIndicator } from "@/features/sessions/context-usage";
import { MarkdownEditor } from "@/components/ai-elements/markdown-editor";
import { DraftAttachmentList } from "@/components/ai-elements/attachment-list";
import { cn } from "@/lib/utils";

function hasDraggedFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

// https://ui.shadcn.com/docs/ai-elements/radix/prompt-input
// Server owns accepted conversation state; InputGroup + Attachment compose the prompt field.
export function PromptInput({ draft, onChange, onAddFiles, focusRequest = 0, onSend, canSend, busy, submitting, uploading, onCancel, canCancel, status,
  permissionMode, onPermissionChange, canChangePermission, permissionSaving, folder, projectPicker, contextUsage, showContextUsage = false }: {
  projectPicker?: ReactNode;
  contextUsage?: ContextUsage;
  showContextUsage?: boolean;
  draft: SessionDraft; onChange: (patch: Partial<SessionDraft>) => void;
  onAddFiles?: (files: File[]) => void;
  focusRequest?: number;
  onSend: () => void; canSend: boolean; busy: boolean; submitting?: boolean; uploading?: boolean;
  onCancel: () => void; canCancel: boolean; status: string;
  permissionMode?: PermissionMode; onPermissionChange: (mode: PermissionMode) => void;
  canChangePermission: boolean; permissionSaving: boolean;
  folder?: Pick<SessionFolder, "name" | "path">;
}) {
  const { t } = useTranslation();
  const statusId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const hasDraftContent = Boolean(draft.text.trim() || draft.attachments.length > 0);
  const attachDisabled = !onAddFiles || Boolean(submitting || uploading);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length > 0) onAddFiles?.(selected);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (attachDisabled || !hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (attachDisabled || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (attachDisabled || !hasDraggedFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (attachDisabled || !hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length > 0) onAddFiles?.(dropped);
  }

  return (
    <div className="relative z-10 w-full">
      {(folder || projectPicker) && <div className="composer-context mb-2.5 flex min-w-0 flex-wrap items-center gap-2 px-0.5 text-xs text-muted-foreground">
        {projectPicker ?? (folder && <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-foreground dark:bg-card" title={folder.path}>
          <Folder className="size-icon shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate font-medium">{folder.name}</span>
        </span>)}
        <span className="inline-flex shrink-0 items-center gap-1.5 px-1 text-muted-foreground"><LaptopMinimal className="size-icon" aria-hidden="true" />{t("workspace:computer")}</span>
      </div>}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={handleFileChange}
      />
      <InputGroup
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "composer composer-surface relative rounded-2xl bg-clip-padding has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-0",
          dragActive && "border-ring bg-muted/35",
        )}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-background/85 backdrop-blur-[1px]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-xs">
              <Upload className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {t("sessions:dropFiles")}
            </span>
          </div>
        )}
        {draft.attachments.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap gap-1.5 px-3 pt-3 pb-0">
            <DraftAttachmentList
              attachments={draft.attachments}
              disabled={Boolean(submitting || uploading)}
              onRemove={id => onChange({ attachments: draft.attachments.filter(attachment => attachment.id !== id) })}
            />
          </InputGroupAddon>
        )}
        <MarkdownEditor value={draft.text} onChange={text => onChange({ text })}
          onPasteFiles={onAddFiles ? files => { if (!attachDisabled) onAddFiles(files); } : undefined}
          label={t("sessions:draft")} placeholder={t(busy ? "sessions:queuePlaceholder" : "sessions:placeholder")}
          focusRequest={focusRequest} onSend={onSend} canSend={canSend} />
        <InputGroupAddon align="block-end" className="min-w-0 flex-wrap gap-1.5 px-2.5 pt-1 pb-2.5">
          {onAddFiles && (
            <InputGroupButton
              variant="ghost"
              size="icon-sm"
              className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
              disabled={attachDisabled}
              aria-label={t("sessions:addAttachment")}
              title={t("sessions:addAttachment")}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-icon" aria-hidden="true" />
            </InputGroupButton>
          )}
          <SessionPermissions mode={permissionMode} onChange={onPermissionChange} disabled={!canChangePermission}
            saving={permissionSaving} busy={busy || Boolean(submitting)} />
          {showContextUsage && <ContextUsageIndicator usage={contextUsage} />}
          <div className="ms-auto flex min-w-0 items-center gap-1.5">
            <span id={statusId} role="status" className="min-w-0 truncate px-1 text-xs font-normal text-muted-foreground empty:px-0">
              {uploading ? t("sessions:uploading") : submitting ? t("sessions:submitting") : status}
            </span>
            {busy && <InputGroupButton variant={hasDraftContent ? "ghost" : "default"} size="icon-sm" className="size-8 shrink-0 rounded-full" disabled={!canCancel} aria-label={t("sessions:stop")} onClick={onCancel}>
              <Square className="size-3.5 fill-current" aria-hidden="true" />
            </InputGroupButton>}
            {(!busy || hasDraftContent) && <InputGroupButton variant="default" size="icon-sm"
              className="size-8 shrink-0 rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
              disabled={!canSend}
              aria-label={t(busy ? "sessions:enqueue" : "sessions:send")} title={t(busy ? "sessions:enqueue" : "sessions:send")} onClick={onSend}>
              {submitting || uploading ? <LoaderCircle className="size-icon motion-safe:animate-spin" aria-hidden="true" /> : <ArrowUp className="size-icon" aria-hidden="true" />}
            </InputGroupButton>}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
