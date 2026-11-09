import { FileText, FolderOpen, PanelRight, X } from "lucide-react";
import { Popover } from "radix-ui";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import type { Session, SessionFolder } from "@/features/sessions/types";
import type { SessionDraft } from "@/features/sessions/use-session-workspace";

export function SessionContext({ folder, session, draft }: {
  folder?: SessionFolder; session?: Session; draft: SessionDraft;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="会话上下文" title="会话上下文" className="size-7 text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground">
          <PanelRight className="size-3.5" aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} collisionPadding={12} aria-label="会话上下文" className="z-50 max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex h-10 items-center justify-between border-b px-3">
            <h2 className="text-xs font-medium">会话上下文</h2>
            <Popover.Close asChild><Button variant="ghost" size="icon-xs" aria-label="关闭会话上下文"><X aria-hidden="true" /></Button></Popover.Close>
          </div>
          <div className="space-y-3 border-b p-3">
            <div className="flex items-center gap-2 text-[13px] font-medium"><FolderOpen className="size-3.5 text-muted-foreground" aria-hidden="true" /><span className="truncate">{folder?.name ?? "未选择工作区"}</span></div>
            {folder && <div className="flex items-center gap-1 rounded-md bg-muted/60 py-1 pr-1 pl-2"><code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={folder.path}>{folder.path}</code><CopyButton value={folder.path} label="复制工作区路径" /></div>}
            <dl className="grid grid-cols-2 gap-y-2 text-xs">
              <dt className="text-muted-foreground">消息记录</dt><dd className="text-right tabular-nums">{session?.messages.length ?? 0} 条</dd>
              <dt className="text-muted-foreground">会话类型</dt><dd className="text-right">{session?.messages.length ? "示例会话" : "本地草稿"}</dd>
            </dl>
          </div>
          <div className="p-3">
            <h3 className="mb-3 flex items-center justify-between text-xs font-medium">草稿附件<span className="font-normal text-muted-foreground tabular-nums">{draft.attachments.length}</span></h3>
            {draft.attachments.length ? (
              <ul className="max-h-48 space-y-2 overflow-y-auto">
                {draft.attachments.map(({ id, file }) => <li key={id} className="flex items-center gap-2 text-xs"><FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{file.size < 1024 ? `${file.size} B` : `${Math.ceil(file.size / 1024)} KB`}</span></li>)}
              </ul>
            ) : <p className="text-xs leading-5 text-muted-foreground">还没有附件。使用输入框中的附件按钮添加文件。</p>}
          </div>
          <p className="border-t bg-muted/30 px-3 py-2.5 text-[11px] leading-4 text-muted-foreground">草稿仅保存在当前页面，刷新后会清空。消息和附件尚不支持发送。</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
