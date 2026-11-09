import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUp, CircleDashed, FileText, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SessionDraft } from "@/features/sessions/use-session-workspace";

// AI Elements Prompt Input pattern. Files and text stay in this local draft;
// no upload or model call is made while the workspace is in preview mode.
export function PromptInput({ draft, onChange, focusRequest = 0, context }: {
  draft: SessionDraft; onChange: (patch: Partial<SessionDraft>) => void; focusRequest?: number; context?: ReactNode;
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
          placeholder="描述任务，或添加文件作为上下文…" value={draft.text}
          onChange={(event) => onChange({ text: event.target.value })}
          className="min-h-20 max-h-48 px-4 pt-3.5 pb-2 text-base leading-6 placeholder:text-muted-foreground md:text-sm" />
        <InputGroupAddon align="block-end" className="gap-2 px-2.5 pt-1 pb-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <InputGroupButton size="sm" className="h-7 gap-1.5 px-2 text-xs font-normal" aria-label="添加上下文附件" onClick={() => fileRef.current?.click()}>
                <Paperclip className="size-3.5" aria-hidden="true" />附件
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>添加附件到草稿</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="ml-auto flex items-center gap-1.5 rounded-sm px-1 text-xs font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="模型未连接">
                <CircleDashed className="size-3" aria-hidden="true" />未连接模型
              </span>
            </TooltipTrigger>
            <TooltipContent>当前为本地预览，消息和附件不会发送。</TooltipContent>
          </Tooltip>
          <InputGroupButton variant="default" size="icon-sm" className="size-7 rounded-md" disabled aria-label="发送消息（未连接模型）">
            <ArrowUp className="size-3.5" aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <p id="composer-status" className="sr-only">
        草稿仅保留在当前页面，暂不支持发送
      </p>
      <div className="mt-2 flex min-w-0 items-center justify-between gap-2 px-1 text-muted-foreground">
        <div className="min-w-0">{context}</div>
        <Tooltip>
          <TooltipTrigger asChild><span tabIndex={0} className="shrink-0 rounded-sm text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring">仅本页保存</span></TooltipTrigger>
          <TooltipContent>草稿和附件会在刷新后清空，当前尚未连接模型。</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
