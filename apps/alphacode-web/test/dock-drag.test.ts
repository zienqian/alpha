import { afterEach, describe, expect, it, vi } from "vitest";
import { Actions, DockLocation } from "flexlayout-react";
import { beginDockDrag, findDockTarget, type DockTarget } from "@/features/session-canvas/dock-drag";
import { addPanel, emptyCanvas, getTabsets } from "@/features/session-canvas/layout";

afterEach(() => { document.dispatchEvent(pointer("pointerdown", 0, 0)); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });
function pointer(type: string, x: number, y: number, id = 1) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: id });
  return event as PointerEvent;
}
function fixture() {
  const canvas = document.createElement("div"); document.body.append(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(200, 40, 1000, 760));
  const source = document.createElement("button"); document.body.append(source);
  const commit = vi.fn();
  const target = vi.fn<(x: number, y: number) => DockTarget | undefined>(() => ({ id: "group", location: DockLocation.LEFT, index: -1, rect: { x: 200, y: 40, width: 500, height: 760 } }));
  let draw: FrameRequestCallback | undefined;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { draw = callback; return 1; });
  const cancel = beginDockDrag({ event: pointer("pointerdown", 60, 100), source, canvas, title: "Session", target, commit });
  return { canvas, source, commit, target, cancel, raf, draw: () => draw?.(0) };
}
describe("pointer docking", () => {
  it("keeps clicks intact, batches moves to one frame, and commits only the release location", () => {
    const f = fixture();
    document.dispatchEvent(pointer("pointermove", 63, 100));
    expect(document.querySelector(".canvas-drag-layer")).toBeNull();
    for (let x = 300; x < 420; x++) document.dispatchEvent(pointer("pointermove", x, 300));
    expect(f.raf).toHaveBeenCalledTimes(1);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.target).toHaveBeenCalledTimes(1);
    expect(f.target).toHaveBeenLastCalledWith(300, 300);
    expect(document.querySelector<HTMLElement>(".canvas-drop-preview")?.style.width).toBe("500px");
    f.draw();
    expect(f.target).toHaveBeenLastCalledWith(419, 300);
    expect(document.querySelector<HTMLElement>(".canvas-drop-preview")?.hidden).toBe(false);
    document.dispatchEvent(pointer("pointerup", 700, 400));
    expect(f.target).toHaveBeenLastCalledWith(700, 400);
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".canvas-drag-layer")).toBeNull();
    expect(document.body.style.userSelect).toBe("");
    f.cancel();
  });
  it.each(["escape", "cancel", "blur", "unmount"])("cleans up %s without committing or leaving pointer listeners", reason => {
    const f = fixture();
    document.dispatchEvent(pointer("pointermove", 400, 300));
    if (reason === "escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else if (reason === "cancel") document.dispatchEvent(pointer("pointercancel", 400, 300));
    else if (reason === "blur") window.dispatchEvent(new Event("blur"));
    else f.cancel();
    document.dispatchEvent(pointer("pointerup", 500, 400));
    expect(f.commit).not.toHaveBeenCalled();
    expect(document.querySelector(".canvas-drag-layer")).toBeNull();
    expect(document.body.style.cursor).toBe("");
  });
  it("ignores another pointer and leaves the layout unchanged on a drop outside", () => {
    const f = fixture();
    document.dispatchEvent(pointer("pointermove", 400, 300, 2));
    expect(document.querySelector(".canvas-drag-layer")).toBeNull();
    document.dispatchEvent(pointer("pointermove", 400, 300));
    f.target.mockReturnValue(undefined);
    document.dispatchEvent(pointer("pointerup", 0, 0));
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("suppresses the source click after Escape even when the pointer is held beyond the next task", () => {
    vi.useFakeTimers();
    const f = fixture();
    const selectSession = vi.fn(); f.source.addEventListener("click", selectSession);
    document.dispatchEvent(pointer("pointermove", 400, 300));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    vi.runAllTimers();
    document.dispatchEvent(pointer("pointerup", 60, 100));
    f.source.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(selectSession).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    vi.runAllTimers();
    f.source.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(selectSession).toHaveBeenCalledTimes(1);
    f.cancel();
  });
  it("merges only on title bars and previews splits throughout the body without mutating the model", () => {
    const { canvas, cancel, target, draw, commit } = fixture();
    const model = emptyCanvas(); addPanel(model, "one"); addPanel(model, "two");
    const groups = getTabsets(model);
    groups.forEach((group, index) => {
      const pane = document.createElement("div"); pane.className = "flexlayout__tabset";
      const bar = document.createElement("div"); bar.className = "flexlayout__tabset_tabbar_outer"; pane.append(bar);
      const marker = document.createElement("span"); marker.dataset.canvasGroup = group.getId(); bar.append(marker); canvas.append(pane);
      const tab = document.createElement("div"); tab.setAttribute("role", "tab"); bar.append(tab);
      vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(new DOMRect(200 + index * 504, 40, 496, 40));
      vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(new DOMRect(200 + index * 504, 40, 120, 40));
      vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(new DOMRect(200 + index * 504, 40, 496, 760));
    });
    const before = model.toJson();
    expect(findDockTarget(canvas, model, undefined, 230, 50)).toMatchObject({ id: groups[0]?.getId(), location: DockLocation.CENTER, index: 0, rect: { x: 200, y: 40, width: 496, height: 760 }, insertion: { x: 202, y: 50, width: 2, height: 20 } });
    expect(findDockTarget(canvas, model, undefined, 400, 60)).toMatchObject({ location: DockLocation.CENTER, index: 1, insertion: { x: 319, y: 50, width: 2, height: 20 } });
    expect(findDockTarget(canvas, model, undefined, 400, 400)?.location).toBe(DockLocation.LEFT);
    expect(findDockTarget(canvas, model, undefined, 500, 400)?.location).toBe(DockLocation.RIGHT);
    expect(findDockTarget(canvas, model, undefined, 448, 300)?.location).toBe(DockLocation.TOP);
    expect(findDockTarget(canvas, model, undefined, 448, 500)?.location).toBe(DockLocation.BOTTOM);
    expect(findDockTarget(canvas, model, undefined, 230, 400)).toMatchObject({ location: DockLocation.LEFT, rect: { x: 200, y: 40, width: 244, height: 760 } });
    expect(findDockTarget(canvas, model, undefined, 660, 400)).toMatchObject({ location: DockLocation.RIGHT, rect: { x: 452, y: 40, width: 244, height: 760 } });
    expect(findDockTarget(canvas, model, undefined, 400, 100)).toMatchObject({ location: DockLocation.TOP, rect: { x: 200, y: 40, width: 496, height: 376 } });
    expect(findDockTarget(canvas, model, undefined, 400, 760)).toMatchObject({ location: DockLocation.BOTTOM, rect: { x: 200, y: 424, width: 496, height: 376 } });
    expect(findDockTarget(canvas, model, undefined, 700, 400)?.location).toBe(DockLocation.RIGHT);
    expect(findDockTarget(canvas, model, undefined, 201, 400)).toMatchObject({ id: model.getRootRow()?.getId(), rect: { x: 200, y: 40, width: 248, height: 760 } });
    expect(findDockTarget(canvas, model, undefined, 190, 400)).toBeUndefined();
    expect(findDockTarget(canvas, model, groups[0]?.getTabNodes()[0]?.getId(), 400, 400)).toBeUndefined();
    expect(model.toJson()).toEqual(before);
    // Exercise the production hit-test -> paint path before pointerup. A valid
    // location alone used to pass while its DOMRect-derived preview was NaN.
    target.mockImplementation((x, y) => findDockTarget(canvas, model, undefined, x, y));
    document.dispatchEvent(pointer("pointermove", 230, 400)); draw();
    const preview = document.querySelector<HTMLElement>(".canvas-drop-preview");
    expect(preview?.hidden).toBe(false);
    expect(preview?.style.width).toBe("244px");
    expect(preview?.style.height).toBe("760px");
    expect(preview?.style.transform).toBe("translate3d(200px,40px,0)");
    document.dispatchEvent(pointer("pointermove", 400, 760)); draw();
    expect(preview?.style.width).toBe("496px");
    expect(preview?.style.height).toBe("376px");
    expect(preview?.style.transform).toBe("translate3d(200px,424px,0)");
    document.dispatchEvent(pointer("pointermove", 400, 60)); draw();
    expect(preview?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".canvas-dock-guides")?.hidden).toBe(true);
    expect(preview?.style.width).toBe("496px");
    expect(preview?.style.height).toBe("760px");
    const insertion = document.querySelector<HTMLElement>(".canvas-tab-insertion");
    expect(insertion?.hidden).toBe(false);
    expect(insertion?.style.transform).toBe("translate3d(319px,50px,0)");
    expect(insertion?.style.width).toBe("2px");
    expect(insertion?.style.height).toBe("20px");
    // Same target pane, different insertion index: the marker must still move.
    document.dispatchEvent(pointer("pointermove", 230, 50)); draw();
    expect(insertion?.style.transform).toBe("translate3d(202px,50px,0)");
    document.dispatchEvent(pointer("pointermove", 400, 400)); draw();
    expect(preview?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>(".canvas-dock-guides")?.hidden).toBe(false);
    expect(preview?.style.width).toBe("244px");
    expect(insertion?.hidden).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(model.toJson()).toEqual(before);
    document.dispatchEvent(pointer("pointermove", 190, 400)); draw();
    expect(preview?.hidden).toBe(true);
    cancel();
    const first = groups[0]; if (!first) throw new Error("Missing fixture pane");
    model.doAction(Actions.maximizeToggle(first.getId()));
    expect(findDockTarget(canvas, model, undefined, 201, 400)?.id).toBe(first.getId());
  });
  it("allows small panes to split onto the growing surface and ignores unavailable panes", () => {
    const { canvas, cancel } = fixture();
    const model = emptyCanvas();
    expect(findDockTarget(canvas, model, undefined, 400, 400)?.location).toBe(DockLocation.CENTER);
    addPanel(model, "one");
    expect(findDockTarget(canvas, model, undefined, 400, 400)).toBeUndefined();
    const pane = document.createElement("div"); pane.className = "flexlayout__tabset"; canvas.append(pane);
    const marker = document.createElement("span"); marker.dataset.canvasGroup = getTabsets(model)[0]?.getId(); pane.append(marker);
    const bounds = vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(new DOMRect(200, 40, 350, 300));
    expect(findDockTarget(canvas, model, undefined, 350, 200)?.location).toBe(DockLocation.LEFT);
    bounds.mockReturnValue(new DOMRect(200, 40, 350, 760));
    expect(findDockTarget(canvas, model, undefined, 230, 300)?.location).toBe(DockLocation.LEFT);
    cancel();
  });
});
