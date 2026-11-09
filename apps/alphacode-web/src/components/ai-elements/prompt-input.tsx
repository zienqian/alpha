import { useEffect, useRef } from "react";
import { ArrowUp, LoaderCircle, Square, FileText, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SessionDraft } from "@/features/sessions/use-session-workspace";

// AI Elements Prompt Input pattern; the server owns accepted conversation state.
export function PromptInput({ draft, onChange, focusRequest = 0, onSend, canSend, busy, submitting, onCancel, canCancel, status }: {
  draft: SessionDraft; onChange: (patch: Partial<SessionDraft>) => void; focusRequest?: number;
  onSend: () => void; canSend: boolean; busy: boolean; submitting?: boolean;
  onCancel: () => void; canCancel: boolean; status: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusRequest > 0) textareaRef.current?.focus();
  }, [focusRequest]);

  return (
    <div className="w-full">
      <input ref={fileRef} type="file" multiple className="sr-only" tabIndex={-1} aria-label="添加附件"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          onChange({ attachments: [...draft.attachments, ...files.map((file) => ({ id: crypto.randomUUID(), file }))] });
          event.target.value = "";
        }} />
      <InputGroup className="composer rounded-2xl border-input bg-background shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-foreground/50 has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/20 dark:bg-card/50">
        {draft.attachments.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap gap-1.5 px-3 pt-3">
            {draft.attachments.map(({ id, file }) => (
              <div key={id} className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted/30 py-0.5 pr-0.5 pl-2 text-xs font-normal">
                <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="max-w-48 truncate" title={file.name}>{file.name}</span>
                <Button variant="ghost" size="icon-xs" aria-label={`移除附件 ${file.name}`}
                  onClick={() => onChange({ attachments: draft.attachments.filter((attachment) => attachment.id !== id) })}>
                  <X className="size-3" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </InputGroupAddon>
        )}
        <InputGroupTextarea ref={textareaRef} aria-label="消息草稿" aria-describedby="composer-status"
          placeholder="描述任务…" value={draft.text}
          onChange={(event) => onChange({ text: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          className="min-h-20 max-h-48 px-4 pt-3.5 pb-2 text-base leading-6 placeholder:text-muted-foreground md:text-sm" />
        <InputGroupAddon align="block-end" className="gap-2 px-2.5 pt-1 pb-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <InputGroupButton size="sm" className="px-2" aria-label="添加上下文附件" onClick={() => fileRef.current?.click()}>
                <Paperclip className="size-3.5" aria-hidden="true" />附件
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>附件仅保留在草稿中，暂不支持上传。</TooltipContent>
          </Tooltip>
          <span id="composer-status" role="status" className="ml-auto truncate px-1 text-xs font-normal">{submitting ? "正在提交…" : status}</span>
          {busy ? <InputGroupButton variant="default" size="icon-sm" disabled={!canCancel} aria-label="停止生成" onClick={onCancel}>
            <Square className="size-3.5" aria-hidden="true" />
          </InputGroupButton> : <InputGroupButton variant="default" size="icon-sm" disabled={!canSend} aria-label="发送消息" onClick={onSend}>
            {submitting ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <ArrowUp className="size-3.5" aria-hidden="true" />}
          </InputGroupButton>}
        </InputGroupAddon>
      </InputGroup>
      {draft.attachments.length > 0 && <p className="mt-2 px-1 text-xs text-muted-foreground">附件暂不支持发送，请移除附件后发送文字。</p>}
    </div>
  );
}
