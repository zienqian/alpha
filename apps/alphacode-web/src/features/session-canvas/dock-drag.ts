import { DockLocation, TabNode, TabSetNode, type Model } from "flexlayout-react";
import { collapseAxis, getTabsets, isCollapsed, minimumSize } from "./layout";

type Box = { x: number; y: number; width: number; height: number };
export type DockTarget = { id: string; location: DockLocation; index: number; rect: Box; insertion?: Box; edge?: string };
const contains = (r: Box, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
function slice(rect: Box, location: DockLocation, ratio: number): Box {
  // DOMRect exposes these values through prototype getters. Object spread
  // drops them, producing NaN dimensions and an invisible split preview.
  const r: Box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  if (location === DockLocation.LEFT || location === DockLocation.RIGHT) {
    r.width = Math.max(0, (r.width - 8) * ratio);
    if (location === DockLocation.RIGHT) r.x += rect.width - r.width;
  } else if (location === DockLocation.TOP || location === DockLocation.BOTTOM) {
    r.height = Math.max(0, (r.height - 8) * ratio);
    if (location === DockLocation.BOTTOM) r.y += rect.height - r.height;
  }
  return r;
}
function edges(rect: Box, x: number, y: number) {
  return [
    { location: DockLocation.LEFT, distance: x - rect.x, extent: rect.width, edge: "left" },
    { location: DockLocation.RIGHT, distance: rect.x + rect.width - x, extent: rect.width, edge: "right" },
    { location: DockLocation.TOP, distance: y - rect.y, extent: rect.height, edge: "top" },
    { location: DockLocation.BOTTOM, distance: rect.y + rect.height - y, extent: rect.height, edge: "bottom" },
  ];
}

/** Read the rendered panes, including gaps. No temporary tabs, mounts or model writes. */
export function findDockTarget(canvas: HTMLElement, model: Model, sourceId: string | undefined, x: number, y: number): DockTarget | undefined {
  const bounds = canvas.getBoundingClientRect();
  if (!contains(bounds, x, y)) return;
  const source = sourceId ? model.getNodeById(sourceId) : undefined;
  const groups = getTabsets(model);
  const fallback = model.getActiveTabset() ?? groups[0];
  if (!fallback) return;
  const center = (id: string, rect: Box): DockTarget => ({ id, rect, location: DockLocation.CENTER, index: -1 });
  // An empty canvas has no existing pane to merge with.
  if (!groups.some(group => group.getTabNodes().length)) return center(fallback.getId(), bounds);
  const panes = groups.flatMap(group => {
    const marker = [...canvas.querySelectorAll<HTMLElement>("[data-canvas-group]")].find(element => element.dataset.canvasGroup === group.getId());
    const element = marker?.closest<HTMLElement>(".flexlayout__tabset");
    const rect = element?.getBoundingClientRect();
    return element && rect && rect.width > 0 && rect.height > 0 ? [{ group, element, rect }] : [];
  });
  // Gaps belong to the nearest pane, so there are no dead strips in the canvas.
  const pane = panes.sort((a, b) => {
    const distance = (r: Box) => Math.max(r.x - x, 0, x - r.x - r.width) ** 2 + Math.max(r.y - y, 0, y - r.y - r.height) ** 2;
    return distance(a.rect) - distance(b.rect);
  })[0];
  if (!pane) return;
  const { group, element, rect } = pane;
  const target = center(group.getId(), rect);
  const collapsed = isCollapsed(group);
  const vertical = collapsed && collapseAxis(group) === "vertical";
  const bar = collapsed ? rect : element.querySelector(".flexlayout__tabset_tabbar_outer")?.getBoundingClientRect();
  if (bar && contains(bar, x, y)) {
    const tabs = [...element.querySelectorAll<HTMLElement>(collapsed ? ".canvas-collapsed-title" : "[role=tab]")]
      .map(tab => tab.getBoundingClientRect()).filter(tab => tab.width > 0 && tab.height > 0);
    target.index = tabs.findIndex(tab => vertical ? y < tab.y + tab.height / 2 : x < tab.x + tab.width / 2);
    if (target.index < 0) target.index = tabs.length;
    const next = tabs[target.index];
    const previous = tabs[target.index - 1];
    if (vertical) {
      const boundary = next ? previous ? (previous.bottom + next.top) / 2 : next.top : previous?.bottom ?? bar.y + 8;
      target.insertion = { x: bar.x + (bar.width - 20) / 2, y: Math.max(bar.y + 2, Math.min(boundary - 1, bar.bottom - 4)), width: 20, height: 2 };
    } else {
      const boundary = next ? previous ? (previous.right + next.left) / 2 : next.left : previous?.right ?? bar.x + 8;
      const height = Math.min(20, Math.max(0, bar.height - 8));
      target.insertion = { x: Math.max(bar.x + 2, Math.min(boundary - 1, bar.right - 4)), y: bar.y + (bar.height - height) / 2, width: 2, height };
    }
    return target;
  }

  // A title bar always means merge, even beside an outer canvas edge.
  const outer = edges(bounds, x, y).sort((a, b) => a.distance - b.distance)[0];
  if (outer && outer.distance < 18 && !model.getMaximizedTabset() && !(groups.length === 1 && source && groups[0]?.getTabNodes().length === 1)) {
    const root = model.getRootRow();
    const parent = source?.getParent();
    const remaining = minimumSize(root, parent instanceof TabSetNode && parent.getTabNodes().length === 1 ? parent.getId() : undefined);
    const horizontal = outer.edge === "left" || outer.edge === "right";
    const extent = horizontal ? bounds.width : bounds.height;
    const min = 220;
    const rest = horizontal ? remaining.width : remaining.height;
    if (root) {
      const ratio = extent >= min + rest + 8 ? Math.min(extent - rest - 8, Math.max(min, (extent - 8) / 4)) / (extent - 8) : .25;
      return { id: root.getId(), location: outer.location, index: -1, rect: slice(bounds, outer.location, ratio), edge: outer.edge };
    }
  }
  // Body drops always split; the scrollable surface grows to fit new panes.
  if (source instanceof TabNode && source.getParent() === group && group.getTabNodes().length === 1) return;
  const bodyTop = bar ? Math.max(rect.y, bar.y + bar.height) : rect.y;
  const body = { x: rect.x, y: bodyTop, width: rect.width, height: Math.max(1, rect.y + rect.height - bodyTop) };
  const edge = edges(body, x, y)
    .sort((a, b) => a.distance / a.extent - b.distance / b.extent)[0];
  if (!edge) return;
  target.location = edge.location;
  target.rect = slice(rect, edge.location, .5);
  return target;
}

type Gesture = {
  event: PointerEvent; source: HTMLElement; canvas: HTMLElement; title: string;
  target: (x: number, y: number) => DockTarget | undefined;
  commit: (target: DockTarget) => void;
};

/** A single RAF paints lightweight previews; React and storage stay idle until release. */
export function beginDockDrag({ event, source, canvas, title, target, commit }: Gesture): () => void {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => undefined;
  let active = false;
  let frame = 0;
  let point = { x: event.clientX, y: event.clientY };
  let overlay: HTMLDivElement | undefined;
  let ghost: HTMLDivElement | undefined;
  let outline: HTMLDivElement | undefined;
  let insertion: HTMLDivElement | undefined;
  let guides: HTMLDivElement | undefined;
  let previousTarget: string | undefined;
  let removeClickGuard = () => undefined as void;
  const oldSelect = doc.body.style.userSelect;
  const oldCursor = doc.body.style.cursor;
  const make = (className: string, parent: HTMLElement) => {
    const element = doc.createElement("div"); element.className = className; parent.append(element); return element;
  };
  const paint = () => {
    frame = 0;
    if (!ghost || !outline || !insertion || !guides) return;
    ghost.style.transform = `translate3d(${Math.min(point.x + 14, win.innerWidth - ghost.offsetWidth - 8)}px,${Math.min(point.y + 18, win.innerHeight - ghost.offsetHeight - 8)}px,0)`;
    const next = target(point.x, point.y);
    ghost.dataset.valid = String(Boolean(next));
    // A title drop already identifies the group: show only its insertion caret.
    outline.hidden = !next || next.location === DockLocation.CENTER;
    guides.hidden = next?.location === DockLocation.CENTER;
    insertion.hidden = !next?.insertion;
    const bounds = canvas.getBoundingClientRect();
    Object.assign(guides.style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
    guides.dataset.edge = next?.edge ?? "";
    if (!next) { previousTarget = undefined; return; }
    const key = JSON.stringify([next.id, next.location.getName(), next.rect, next.insertion]);
    if (key !== previousTarget) {
      const { x, y, width, height } = next.rect;
      outline.dataset.initial = String(previousTarget === undefined);
      Object.assign(outline.style, { transform: `translate3d(${x}px,${y}px,0)`, width: `${width}px`, height: `${height}px` });
      if (next.insertion) {
        const { x, y, width, height } = next.insertion;
        Object.assign(insertion.style, { transform: `translate3d(${x}px,${y}px,0)`, width: `${width}px`, height: `${height}px` });
      }
      previousTarget = key;
    }
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    point = { x: e.clientX, y: e.clientY };
    if (!active) {
      if (Math.hypot(point.x - event.clientX, point.y - event.clientY) < 5) return;
      active = true;
      overlay = make("canvas-drag-layer", canvas);
      overlay.setAttribute("aria-hidden", "true");
      guides = make("canvas-dock-guides", overlay);
      for (const edge of ["left", "right", "top", "bottom"]) make("canvas-dock-edge", guides).classList.add(`canvas-dock-edge-${edge}`);
      outline = make("canvas-drop-preview", overlay);
      insertion = make("canvas-tab-insertion", overlay);
      ghost = make("canvas-drag-ghost", overlay); ghost.textContent = title;
      source.dataset.canvasDragging = "true";
      doc.body.style.userSelect = "none"; doc.body.style.cursor = "grabbing";
      source.setPointerCapture?.(event.pointerId);
      // Show the first target immediately, including quick drags that release
      // before the next animation frame. Later moves remain frame-batched.
      e.preventDefault();
      paint();
      return;
    }
    e.preventDefault();
    if (!frame) frame = win.requestAnimationFrame(paint);
  };
  const guardClick = (released: boolean) => {
    let timer: number | undefined;
    const suppress = (e: MouseEvent) => { if (e.detail !== 0) { e.preventDefault(); e.stopImmediatePropagation(); } };
    const remove = () => {
      win.clearTimeout(timer);
      doc.removeEventListener("click", suppress, true);
      doc.removeEventListener("pointerup", release, true);
      doc.removeEventListener("pointerdown", remove, true);
    };
    const release = (e: PointerEvent) => { if (e.pointerId === event.pointerId) timer = win.setTimeout(remove, 0); };
    doc.addEventListener("click", suppress, true);
    doc.addEventListener("pointerdown", remove, true);
    if (released) timer = win.setTimeout(remove, 0);
    else doc.addEventListener("pointerup", release, true);
    removeClickGuard = remove;
  };
  const cleanup = (released = false, disposing = false) => {
    win.cancelAnimationFrame(frame);
    doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("pointerup", up, true);
    doc.removeEventListener("pointercancel", cancelPointer, true);
    doc.removeEventListener("keydown", key, true);
    win.removeEventListener("blur", cancel);
    source.removeEventListener("lostpointercapture", cancelPointer);
    if (source.hasPointerCapture?.(event.pointerId)) source.releasePointerCapture(event.pointerId);
    if (active) {
      overlay?.remove(); delete source.dataset.canvasDragging;
      doc.body.style.userSelect = oldSelect; doc.body.style.cursor = oldCursor;
      // Escape may cancel while the button is still held. Keep the guard until
      // that release, or discard it at the next independent pointer gesture.
      if (!disposing) guardClick(released);
      active = false;
    }
  };
  const cancel = () => cleanup();
  const cancelPointer = (e: PointerEvent) => { if (e.pointerId === event.pointerId) cleanup(); };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cleanup(); } };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    const result = active ? target(e.clientX, e.clientY) : undefined;
    cleanup(true);
    if (result) commit(result);
  };
  doc.addEventListener("pointermove", move, { capture: true, passive: false });
  doc.addEventListener("pointerup", up, true);
  doc.addEventListener("pointercancel", cancelPointer, true);
  doc.addEventListener("keydown", key, true);
  source.addEventListener("lostpointercapture", cancelPointer);
  win.addEventListener("blur", cancel);
  return () => { cleanup(false, true); removeClickGuard(); };
}
