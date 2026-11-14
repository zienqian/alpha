import { Actions, DockLocation, Model, Orientation, TabNode, TabSetNode, type Node, type IJsonModel, type IJsonRowNode, type IJsonTabNode, type IJsonTabSetNode } from "flexlayout-react";

export const canvasStorageKey = "alphacode-session-canvas-v2";
export const legacyCanvasStorageKey = "alphacode-session-canvas-v1";
export type CanvasPanel = { panelId: string; sessionId: string };
const global: IJsonModel["global"] = {
  tabEnableRename: false, tabEnablePin: false, tabEnablePopout: false, tabEnableFloat: false,
  tabEnableScrollbars: false, tabSetEnableTabGroups: false, tabSetEnableCloseButton: false,
  tabSetMinWidth: 220, tabSetMinHeight: 180, tabSetEnableSingleTabStretch: false,
  enableEdgeDockIndicators: false,
};
const blank = (): IJsonRowNode => ({ type: "row", id: "workspace", children: [{ type: "tabset", id: "main", children: [] }] });
export const emptyCanvas = () => Model.fromJson({ global, borders: [], layout: blank() });
export const sessionIdOf = (node: TabNode): string => node.getConfig().sessionId;
export const isCollapsed = (node: Node | undefined): boolean => node instanceof TabSetNode && node.getConfig()?.collapsed === true;
export function collapseAxis(node: TabSetNode) {
  const parent = node.getParent();
  return parent?.getOrientation() === Orientation.HORZ && parent.getChildren().length > 1 ? "vertical" : "horizontal";
}
function collapseAttributes(node: TabSetNode, collapsed: boolean) {
  const vertical = collapseAxis(node) === "vertical";
  return { config: { collapsed },
    classNameTabStrip: collapsed ? vertical ? "canvas-tabbar-collapsed canvas-tabbar-vertical" : "canvas-tabbar-collapsed canvas-tabbar-horizontal" : undefined,
    minWidth: collapsed && vertical ? 44 : 220, maxWidth: collapsed && vertical ? 44 : 99999,
    // FlexLayout adds the measured 40px tab strip to the content height limits.
    minHeight: collapsed ? vertical ? 0 : 2 : 180, maxHeight: collapsed && !vertical ? 2 : 99999 };
}
export function expandGroupAction(node: TabSetNode) {
  return Actions.updateNodeAttributes(node.getId(), collapseAttributes(node, false));
}
export function collapseGroupAction(node: TabSetNode) {
  return Actions.updateNodeAttributes(node.getId(), collapseAttributes(node, true));
}
export function collapseGroup(node: TabSetNode) {
  const model = node.getModel();
  const actions = [];
  if (node.isMaximized()) actions.push(Actions.maximizeToggle(node.getId()));
  actions.push(collapseGroupAction(node));
  const next = getTabsets(model).find(group => group !== node && !isCollapsed(group))?.getSelectedNode();
  if (node.isActive() && next) actions.push(Actions.selectTab(next.getId()));
  model.doAction(Actions.group(actions));
}
export function syncCollapsedGroups(model: Model) {
  const actions = getTabsets(model).filter(isCollapsed).flatMap(node => {
    const attrs = collapseAttributes(node, true);
    return node.getClassNameTabStrip() === attrs.classNameTabStrip ? [] : [Actions.updateNodeAttributes(node.getId(), attrs)];
  });
  if (actions.length) model.doAction(Actions.group(actions));
}
export function getPanels(model: Model): CanvasPanel[] {
  const panels: CanvasPanel[] = [];
  model.visitNodes(node => { if (node instanceof TabNode) panels.push({ panelId: node.getId(), sessionId: sessionIdOf(node) }); });
  return panels;
}
export function getTabsets(model: Model): TabSetNode[] {
  const sets: TabSetNode[] = [];
  model.visitNodes(node => { if (node instanceof TabSetNode) sets.push(node); });
  return sets;
}
export function focusedTab(model: Model): TabNode | undefined {
  return model.getActiveTabset()?.getSelectedNode() ?? model.getFirstTabSet()?.getSelectedNode();
}
export function minimumSize(node: Node | undefined, excludeGroup?: string): { width: number; height: number } {
  if (!node || node.getId() === excludeGroup) return { width: 0, height: 0 };
  if (node instanceof TabSetNode) return isCollapsed(node)
    ? collapseAxis(node) === "vertical" ? { width: 44, height: 42 } : { width: 220, height: 42 }
    : { width: 220, height: 220 };
  const sizes = node.getChildren().filter(child => child.getType() === "row" || child instanceof TabSetNode)
    .map(child => minimumSize(child, excludeGroup)).filter(size => size.width || size.height);
  const horizontal = node.getOrientation() === Orientation.HORZ;
  return {
    width: horizontal ? sizes.reduce((sum, size) => sum + size.width, 0) + Math.max(0, sizes.length - 1) * 8 : Math.max(0, ...sizes.map(size => size.width)),
    height: horizontal ? Math.max(0, ...sizes.map(size => size.height)) : sizes.reduce((sum, size) => sum + size.height, 0) + Math.max(0, sizes.length - 1) * 8,
  };
}
export function tabJson(sessionId: string, name = sessionId, panelId = "panel-" + crypto.randomUUID()): IJsonTabNode {
  return { type: "tab", id: panelId, component: "session", name, config: { sessionId } };
}
export function focusPanel(model: Model, panelId: string) {
  const node = model.getNodeById(panelId);
  if (!(node instanceof TabNode)) return;
  const actions = [];
  const parent = node.getParent();
  if (parent instanceof TabSetNode && isCollapsed(parent)) actions.push(expandGroupAction(parent));
  const maximized = model.getMaximizedTabset();
  if (maximized && maximized !== node.getParent()) actions.push(Actions.maximizeToggle(maximized.getId()));
  if (!node.isSelected() || model.getActiveTabset() !== node.getParent()) actions.push(Actions.selectTab(panelId));
  if (actions.length) model.doAction(Actions.group(actions));
}
export function addPanel(model: Model, sessionId: string, name = sessionId) {
  const panels = getPanels(model);
  const existing = panels.find(panel => panel.sessionId === sessionId);
  if (existing) { focusPanel(model, existing.panelId); return existing.panelId; }
  const target = model.getActiveTabset() ?? model.getFirstTabSet();
  if (!target) return;
  const tab = tabJson(sessionId, name);
  // First two conversations open side by side. Further additions become tabs;
  // Dragging can give further conversations their own region.
  model.doAction(Actions.addTab(tab, target.getId(), panels.length === 1 ? DockLocation.RIGHT : DockLocation.CENTER, -1, true));
  return tab.id;
}
export function selectPanel(model: Model, sessionId: string, name = sessionId) {
  const existing = getPanels(model).find(panel => panel.sessionId === sessionId);
  if (existing) { focusPanel(model, existing.panelId); return; }
  const target = focusedTab(model);
  if (!target) { addPanel(model, sessionId, name); return; }
  const parent = target.getParent();
  model.doAction(Actions.group([
    ...(parent instanceof TabSetNode && isCollapsed(parent) ? [expandGroupAction(parent)] : []),
    Actions.updateNodeAttributes(target.getId(), { config: { sessionId }, name }),
  ]));
}
export function removePanel(model: Model, panelId: string) {
  if (model.getNodeById(panelId) instanceof TabNode) model.doAction(Actions.deleteTab(panelId));
}
export function resetCanvas(model: Model): Model {
  const tabs = getPanels(model).map(panel => tabJson(panel.sessionId, (model.getNodeById(panel.panelId) as TabNode).getName(), panel.panelId));
  const selected = focusedTab(model)?.getId();
  const group = (nodes: IJsonTabNode[]): IJsonTabSetNode => ({ type: "tabset", weight: 100, selected: 0,
    active: nodes.some(node => node.id === selected), children: nodes });
  const columns = [tabs.filter((_, i) => i % 2 === 0), tabs.filter((_, i) => i % 2 === 1)].filter(items => items.length);
  const layout: IJsonRowNode = tabs.length ? { type: "row", id: "workspace",
    children: columns.map(items => items.length > 1 ? { type: "row", weight: 50, children: items.map(tab => group([tab])) } : { ...group(items), weight: 50 }) } : blank();
  // The library adopts existing tab view state when replacing a layout model.
  return Model.fromJson({ global, borders: [], layout }, model);
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 300;
/** Keep only layout structure and session references; ignore arbitrary persisted library options. */
function sanitizeLayout(value: unknown): IJsonRowNode {
  const sessionIds = new Set<string>();
  const nodeIds = new Set<string>();
  const weight = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100000 ? value : 100;
  function clean(value: unknown): IJsonRowNode | IJsonTabSetNode | undefined {
    if (!record(value) || !Array.isArray(value.children)) return;
    if (value.type !== "row" && value.type !== "tabset") return;
    const id = validId(value.id) && !nodeIds.has(value.id) ? value.id : "group-" + crypto.randomUUID();
    nodeIds.add(id);
    if (value.type === "row") {
      const children = value.children.map(clean).filter(item => item !== undefined);
      return children.length ? { type: "row", id, weight: weight(value.weight), children } : undefined;
    }
    const selectedId = record(value.children[Number(value.selected) || 0]) ? value.children[Number(value.selected) || 0].id : undefined;
    const children: IJsonTabNode[] = [];
    for (const child of value.children) {
      if (!record(child) || child.type !== "tab" || !validId(child.id) || nodeIds.has(child.id)
        || !record(child.config) || !validId(child.config.sessionId) || child.config.sessionId.startsWith("local-")
        || sessionIds.has(child.config.sessionId)) continue;
      sessionIds.add(child.config.sessionId); nodeIds.add(child.id);
      children.push(tabJson(child.config.sessionId, child.id, child.id));
    }
    if (!children.length) return;
    return { type: "tabset", id, weight: weight(value.weight), active: value.active === true,
      ...(record(value.config) && value.config.collapsed === true ? { config: { collapsed: true } } : {}),
      selected: Math.max(0, children.findIndex(tab => tab.id === selectedId)), children };
  }
  const result = clean(value);
  return result?.type === "row" ? result : blank();
}
export function readCanvas(): Model {
  try {
    const raw = localStorage.getItem(canvasStorageKey);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      const model = record(value) && value.version === 2 ? Model.fromJson({ global, borders: [], layout: sanitizeLayout(value.layout) }) : emptyCanvas();
      syncCollapsedGroups(model);
      return model;
    }
    const legacy: unknown = JSON.parse(localStorage.getItem(legacyCanvasStorageKey) ?? "null");
    if (!record(legacy) || legacy.version !== 1 || !Array.isArray(legacy.panels)) return emptyCanvas();
    const model = emptyCanvas();
    for (const panel of legacy.panels) {
      if (!record(panel) || !validId(panel.sessionId) || panel.sessionId.startsWith("local-")) continue;
      addPanel(model, panel.sessionId);
    }
    const next = resetCanvas(model);
    const selected = legacy.panels.find(panel => record(panel) && panel.panelId === legacy.focusedPanelId);
    const target = getPanels(next).find(panel => panel.sessionId === (record(selected) ? selected.sessionId : undefined));
    if (target) focusPanel(next, target.panelId);
    return next;
  } catch { return emptyCanvas(); }
}
export function saveCanvas(model: Model): boolean {
  try {
    localStorage.setItem(canvasStorageKey, JSON.stringify({ version: 2, layout: sanitizeLayout(model.toJson().layout) }));
    return true;
  } catch { return false; }
}
