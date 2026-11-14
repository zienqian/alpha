import { afterEach, describe, expect, it, vi } from "vitest";
import { Actions, DockLocation, RowNode, type Action } from "flexlayout-react";
import { beginCollapsedResize } from "@/features/session-canvas/collapsed-resize";
import { addPanel, collapseGroup, emptyCanvas, getTabsets, isCollapsed } from "@/features/session-canvas/layout";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function pointer(type: string, x: number, y: number, id = 1) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: id });
  return event as PointerEvent;
}
function fixture(vertical = false, trailing = false) {
  const model = emptyCanvas(); addPanel(model, "a"); const b = addPanel(model, "b");
  const firstGroup = getTabsets(model)[0];
  if (!firstGroup) throw new Error("Missing fixture group");
  if (vertical && b) model.doAction(Actions.moveNode(b, firstGroup.getId(), DockLocation.BOTTOM, -1, true));
  const groups = getTabsets(model);
  const group = groups[trailing ? 1 : 0];
  if (!group) throw new Error("Missing collapsed group");
  collapseGroup(group);
  const row = group.getParent();
  if (!(row instanceof RowNode)) throw new Error("Missing resize row");
  const wrapper = document.createElement("div"); document.body.append(wrapper);
  const first = document.createElement("div");
  const splitter = document.createElement("div"); splitter.setAttribute("role", "separator"); splitter.dataset.layoutPath = row.getPath() + "/s0";
  const second = document.createElement("div"); wrapper.append(first, splitter, second);
  const collapsedSize = vertical ? 42 : 44;
  for (const [i, element] of [first, second].entries()) {
    const size = i === (trailing ? 1 : 0) ? collapsedSize : 950;
    element.getBoundingClientRect = () => new DOMRect(0, 0, vertical ? 1000 : size, vertical ? size : 760);
  }
  const before = model.toJson();
  const actions: Action[] = []; model.addChangeListener(action => actions.push(action));
  let frame: FrameRequestCallback | undefined;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frame = callback; return 1; });
  const cancel = beginCollapsedResize(pointer("pointerdown", 400, 400), splitter, model);
  const move = (amount: number, type = "pointermove") => document.dispatchEvent(pointer(type, vertical ? 400 : 400 + amount, vertical ? 400 + amount : 400));
  return { model, group, row, before, actions, raf, cancel, move, draw: () => frame?.(0) };
}
describe("resizing a collapsed pane", () => {
  it.each([[false, false], [false, true], [true, false], [true, true]])("expands and resizes on either axis (%s, %s), saving only on release", (vertical, trailing) => {
    const f = fixture(vertical, trailing);
    const direction = trailing ? -1 : 1;
    f.move(2 * direction);
    expect(f.model.toJson()).toEqual(f.before);
    f.move(250 * direction);
    expect(isCollapsed(f.group)).toBe(false);
    for (let i = 251; i <= 350; i++) f.move(i * direction);
    expect(f.raf).toHaveBeenCalledTimes(1);
    expect(f.actions.every(action => action.isAdjusting())).toBe(true);
    f.draw();
    f.move(350 * direction, "pointerup");
    expect(f.actions.filter(action => !action.isAdjusting())).toHaveLength(1);
    expect(f.row.getChildren()[trailing ? 1 : 0]?.getAttributeOwn("weight")).toBeCloseTo(((vertical ? 42 : 44) + 350) / ((vertical ? 42 : 44) + 950) * 100);
    expect(document.body.style.cursor).toBe("");
    f.cancel?.();
    expect(isCollapsed(f.group)).toBe(false);
  });
  it.each(["escape", "cancel", "blur", "dispose"])("restores the collapsed state and proportions on %s", reason => {
    const f = fixture(); f.move(300);
    if (reason === "escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else if (reason === "cancel") document.dispatchEvent(pointer("pointercancel", 700, 400));
    else if (reason === "blur") window.dispatchEvent(new Event("blur"));
    else f.cancel?.();
    f.move(400, "pointerup");
    expect(f.model.toJson()).toEqual(f.before);
    expect(f.actions.every(action => action.isAdjusting())).toBe(true);
    expect(document.body.style.userSelect).toBe("");
  });
  it("ignores another pointer, a click, and dragging toward the collapsed pane", () => {
    const f = fixture();
    document.dispatchEvent(pointer("pointermove", 700, 400, 2));
    f.move(-200);
    f.move(0, "pointerup");
    expect(f.model.toJson()).toEqual(f.before);
    expect(f.actions).toHaveLength(0);
  });
});
