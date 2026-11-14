import { Actions, Orientation, RowNode, TabSetNode, type Model, type Node } from "flexlayout-react";
import { collapseGroupAction, expandGroupAction, isCollapsed } from "./layout";

/** The library fixes collapsed sizes. Handle only splitters beside a collapsed
 * group; ordinary resizing continues through FlexLayout's own implementation. */
export function beginCollapsedResize(event: PointerEvent, splitter: HTMLElement, model: Model): (() => void) | undefined {
  const path = splitter.dataset.layoutPath;
  const match = path?.match(/^(.*)\/s(\d+)$/);
  if (!match || event.button !== 0 || event.isPrimary === false) return;
  let row: RowNode | undefined;
  model.visitNodes(node => { if (node instanceof RowNode && node.getPath() === match[1]) row = node; });
  if (!row) return;
  const rowId = row.getId();
  const nodes = row.getChildren().filter((node): node is RowNode | TabSetNode => node instanceof RowNode || node instanceof TabSetNode);
  const index = Number(match[2]);
  const before = nodes[index];
  const after = nodes[index + 1];
  if (!before || !after || !isCollapsed(before) && !isCollapsed(after)) return;
  const horizontal = row.getOrientation() === Orientation.HORZ;
  const blocks = [...splitter.parentElement?.children ?? []].filter(element => element.getAttribute("role") !== "separator");
  if (blocks.length !== nodes.length) return;
  const sizes = blocks.map(element => { const rect = element.getBoundingClientRect(); return horizontal ? rect.width : rect.height; });
  if (sizes.some(size => size <= 0)) return;
  const sum = sizes.reduce((total, size) => total + size, 0);
  const beforeSize = sizes[index];
  const afterSize = sizes[index + 1];
  if (beforeSize === undefined || afterSize === undefined) return;
  const pairSize = beforeSize + afterSize;
  const originalWeights = nodes.map(node => node.getWeight());
  const doc = splitter.ownerDocument;
  const win = doc.defaultView;
  if (!win) return;
  let delta = 0;
  let frame = 0;
  let expanded: TabSetNode | undefined;
  let weights = originalWeights;
  const oldCursor = doc.body.style.cursor;
  const oldSelect = doc.body.style.userSelect;
  const draw = () => {
    frame = 0;
    const candidate = expanded ?? (delta > 0 ? before : after);
    if (!(candidate instanceof TabSetNode) || !expanded && (!isCollapsed(candidate) || Math.abs(delta) < 5)) return;
    const minimum = (node: Node): number => {
      if (node === candidate) return 220;
      if (node instanceof TabSetNode) return horizontal ? Math.max(node.getMinWidth(), node.getAttrMinWidth())
        : Math.max(node.getMinHeight(), node.getAttrMinHeight() + 40);
      const children = node.getChildren().map(minimum);
      return (node.getOrientation() === Orientation.HORZ) === horizontal
        ? children.reduce((total, size) => total + size, 0) + Math.max(0, children.length - 1) * 8 : Math.max(0, ...children);
    };
    const minBefore = minimum(before);
    const minAfter = minimum(after);
    if (pairSize < minBefore + minAfter) return;
    const next = [...sizes];
    next[index] = Math.max(minBefore, Math.min(pairSize - minAfter, beforeSize + delta));
    next[index + 1] = pairSize - next[index];
    weights = next.map(size => size / sum * 100);
    const resize = Actions.adjustWeights(rowId, weights);
    if (!expanded) {
      expanded = candidate;
      splitter.classList.add("canvas-resize-active");
      doc.body.style.cursor = horizontal ? "ew-resize" : "ns-resize";
      doc.body.style.userSelect = "none";
      model.doAction(Actions.group([expandGroupAction(candidate), resize]).setAdjusting(true));
    } else model.doAction(resize.setAdjusting(true));
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    delta = horizontal ? e.clientX - event.clientX : e.clientY - event.clientY;
    e.preventDefault();
    if (!expanded) draw();
    else if (!frame) frame = win.requestAnimationFrame(draw);
  };
  const cleanup = () => {
    win.cancelAnimationFrame(frame);
    doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("pointerup", up, true);
    doc.removeEventListener("pointercancel", pointerCancel, true);
    doc.removeEventListener("keydown", key, true);
    win.removeEventListener("blur", cancel);
    splitter.removeEventListener("lostpointercapture", pointerCancel);
    if (splitter.hasPointerCapture?.(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
    splitter.classList.remove("canvas-resize-active");
    doc.body.style.cursor = oldCursor;
    doc.body.style.userSelect = oldSelect;
  };
  const cancel = () => {
    cleanup();
    if (expanded) {
      model.doAction(Actions.group([collapseGroupAction(expanded), Actions.adjustWeights(rowId, originalWeights)]).setAdjusting(true));
      expanded = undefined;
    }
  };
  const pointerCancel = (e: PointerEvent) => { if (e.pointerId === event.pointerId) cancel(); };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    delta = horizontal ? e.clientX - event.clientX : e.clientY - event.clientY;
    win.cancelAnimationFrame(frame); draw(); cleanup();
    if (expanded) { expanded = undefined; model.doAction(Actions.adjustWeights(rowId, weights)); }
  };
  doc.addEventListener("pointermove", move, { capture: true, passive: false });
  doc.addEventListener("pointerup", up, true);
  doc.addEventListener("pointercancel", pointerCancel, true);
  doc.addEventListener("keydown", key, true);
  win.addEventListener("blur", cancel);
  splitter.addEventListener("lostpointercapture", pointerCancel);
  splitter.setPointerCapture?.(event.pointerId);
  return cancel;
}
