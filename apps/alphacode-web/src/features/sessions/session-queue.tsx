import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { CornerDownRight, GripVertical, ListEnd, LoaderCircle, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { SessionView } from "./api";
import { useTranslation } from "@/i18n/react";

type QueuedMessage = NonNullable<SessionView["state"]["queuedRequests"]>[number];

export function SessionQueue({ requests = [], disabled, canSteer, onRemove, onEdit, onMove, onSteer }: {
  requests: readonly QueuedMessage[] | undefined;
  disabled: boolean;
  canSteer: boolean;
  onRemove: (requestId: string) => void;
  onEdit: (requestId: string, input: string, expectedInput: string) => Promise<boolean>;
  onMove: (requestId: string, beforeRequestId: string | null) => Promise<boolean>;
  onSteer: (requestId: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ requestId: string; input: string; original: string }>();
  const [order, setOrder] = useState<string[]>();
  const [dragging, setDragging] = useState<string>();
  const drag = useRef<{ id: string; order: string[]; changed: boolean } | undefined>(undefined);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const menus = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!editing && returnFocus.current) {
      menus.current.get(returnFocus.current)?.focus();
      returnFocus.current = undefined;
    }
  }, [editing]);
  const ordered = order ? [...requests].sort((a, b) => order.indexOf(a.requestId) - order.indexOf(b.requestId)) : requests;
  const editExpired = Boolean(editing && !requests.some(request => request.requestId === editing.requestId));
  const visible = editExpired && editing ? [...ordered, { requestId: editing.requestId, input: editing.original }] : ordered;

  function startDrag(event: PointerEvent<HTMLButtonElement>, requestId: string) {
    if (event.button !== 0 || disabled || editing || requests.length < 2) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: requestId, order: requests.map(item => item.requestId), changed: false };
    setDragging(requestId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || disabled) return;
    const target = current.order.find(id => {
      const rect = rows.current.get(id)?.getBoundingClientRect();
      return rect && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (!target || target === current.id) return;
    const next = [...current.order];
    const targetIndex = next.indexOf(target);
    next.splice(next.indexOf(current.id), 1);
    next.splice(targetIndex, 0, current.id);
    current.order = next;
    current.changed = true;
    setOrder(next);
  }

  async function finishDrag(cancelled = false) {
    const current = drag.current;
    drag.current = undefined;
    setDragging(undefined);
    if (current?.changed && !cancelled && !disabled) {
      const index = current.order.indexOf(current.id);
      await onMove(current.id, current.order[index + 1] ?? null);
    }
    setOrder(undefined);
  }

  async function saveEdit() {
    if (!editing || disabled || editExpired || !editing.input.trim()) return;
    if (await onEdit(editing.requestId, editing.input, editing.original)) finishEditing();
  }

  function finishEditing() {
    returnFocus.current = editing?.requestId;
    setEditing(undefined);
  }

  if (!visible.length) return null;
  return <section aria-label={t("sessions:queueLabel")}
    className="relative mx-3 -mb-4 rounded-t-2xl border border-border/50 bg-background pt-0.5 pb-4">
    <p role="status" className="sr-only">{t("sessions:queueCount", { count: requests.length })}</p>
    <ol className="max-h-60 overflow-y-auto px-1 py-0.5 sm:px-2">
      {visible.map((request, index) => {
        const isEditing = editing?.requestId === request.requestId;
        const locked = disabled || Boolean(request.steering) || Boolean(editing);
        return <li key={request.requestId} ref={node => { if (node) rows.current.set(request.requestId, node); else rows.current.delete(request.requestId); }}
          className={cn("group/queued flex min-h-10 min-w-0 items-start gap-1 rounded-lg px-1 text-sm", dragging === request.requestId && "bg-muted")}>
          <div className="flex h-10 shrink-0 items-center text-muted-foreground/70">
            <button type="button" disabled={locked || Boolean(editing) || requests.length < 2}
              className="flex h-7 w-3 touch-none cursor-grab items-center justify-center rounded-sm opacity-0 outline-none group-hover/queued:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default active:cursor-grabbing [@media(pointer:coarse)]:w-6 [@media(pointer:coarse)]:opacity-100"
              aria-label={t("sessions:reorderQueued", { position: index + 1 })} title={t("sessions:reorderHint")}
              onPointerDown={event => startDrag(event, request.requestId)} onPointerMove={moveDrag}
              onPointerUp={() => void finishDrag()} onPointerCancel={() => void finishDrag(true)}
              onKeyDown={event => {
                if (event.key === "Escape") { void finishDrag(true); return; }
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                event.preventDefault();
                if (event.key === "ArrowUp" && index > 0) void onMove(request.requestId, requests[index - 1]?.requestId ?? null);
                if (event.key === "ArrowDown" && index < requests.length - 1) void onMove(request.requestId, requests[index + 2]?.requestId ?? null);
              }}><GripVertical className="size-3" aria-hidden="true" /></button>
            <ListEnd className="mx-1 size-3.5" aria-hidden="true" />
          </div>
          {isEditing ? <div className="min-w-0 flex-1 py-2 pr-1">
            <textarea autoFocus aria-label={t("sessions:editQueued")} value={editing.input} disabled={disabled}
              onChange={event => setEditing({ ...editing, input: event.target.value })}
              onKeyDown={event => {
                if (event.key === "Escape") { event.preventDefault(); if (!disabled) finishEditing(); }
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault(); void saveEdit();
                }
              }} rows={2} className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-base leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:text-sm" />
            {editExpired && <p role="alert" className="mt-1 text-xs text-muted-foreground">{t("sessions:queueEditExpired")}</p>}
            <div className="mt-1 flex justify-end gap-1">
              <Button size="sm" variant="ghost" disabled={disabled} onClick={finishEditing}>{t("sessions:cancelEdit")}</Button>
              <Button size="sm" disabled={disabled || editExpired || !editing.input.trim()} onClick={() => void saveEdit()}>{t("sessions:saveEdit")}</Button>
            </div>
          </div> : <>
            <span className="min-w-0 flex-1 truncate py-2.5 leading-5" title={request.input}>{request.input}</span>
            <div className="flex h-10 shrink-0 items-center gap-0.5 text-muted-foreground">
              <Button variant="ghost" size="sm" className="gap-1 px-1.5 font-normal" disabled={locked || !canSteer}
                title={t("sessions:steerHint")} aria-label={t("sessions:steerQueued", { position: index + 1 })}
                onClick={() => void onSteer(request.requestId)}>
                {request.steering ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <CornerDownRight className="size-3.5" aria-hidden="true" />}
                {t(request.steering ? "sessions:steering" : "sessions:steer")}
              </Button>
              <Button variant="ghost" size="icon-sm" className="rounded-full" disabled={locked}
                aria-label={t("sessions:removeQueued", { position: index + 1 })} title={t("sessions:removeFromQueue")}
                onClick={() => onRemove(request.requestId)}><Trash2 aria-hidden="true" /></Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="rounded-full" disabled={locked}
                  ref={node => { if (node) menus.current.set(request.requestId, node); else menus.current.delete(request.requestId); }}
                  aria-label={t("sessions:queuedMenu", { position: index + 1 })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40 rounded-2xl p-1.5" onCloseAutoFocus={event => { if (editing) event.preventDefault(); }}>
                  <DropdownMenuItem className="rounded-lg" onSelect={() => setEditing({ requestId: request.requestId, input: request.input, original: request.input })}>
                    <Pencil aria-hidden="true" />{t("sessions:editQueued")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>}
        </li>;
      })}
    </ol>
  </section>;
}
