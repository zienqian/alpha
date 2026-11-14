import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { Actions, I18nLabel, Layout, TabNode, TabSetNode, type Action, type ITabSetRenderValues } from "flexlayout-react";
import { ChevronDown, ChevronLeft, ChevronUp, Maximize2, MessageSquare, Minimize2, X } from "lucide-react";
import { useTranslation } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { SessionPane } from "@/features/sessions/session-pane";
import { useSessionWorkspace, type SessionWorkspace } from "@/features/sessions/use-session-workspace";
import { SessionApiError } from "@/features/sessions/api";
import { useExperimentalFeatures } from "@/features/settings/experimental-features";
import { addPanel, collapseAxis, collapseGroup, expandGroupAction, focusedTab, focusPanel, getPanels, isCollapsed, minimumSize, readCanvas, removePanel, saveCanvas, selectPanel, sessionIdOf, syncCollapsedGroups, tabJson } from "./layout";
import { beginDockDrag, findDockTarget } from "./dock-drag";
import { beginCollapsedResize } from "./collapsed-resize";
import "flexlayout-react/style/light.css";
import "./session-canvas.css";

// Use the same Lucide strokes as the rest of the workspace, including the
// controls owned by FlexLayout. Keep the icon map stable between renders.
const layoutIcons = {
  close: <X aria-hidden="true" />,
  maximize: <Maximize2 aria-hidden="true" />,
  restore: <Minimize2 aria-hidden="true" />,
  more: <ChevronDown aria-hidden="true" />,
};

const CanvasSession = memo(function CanvasSession({ sessionId, panelId, close, focus }: {
  sessionId: string; panelId: string; close: (id: string) => void; focus: (id: string) => void;
}) {
  const { t } = useTranslation();
  const workspace = useSessionWorkspace(sessionId);
  const title = workspace.selectedSession?.title || t("sessions:new");
  const error = workspace.history.error;
  useEffect(() => { if (error instanceof SessionApiError && error.status === 404) close(panelId); }, [error, panelId, close]);
  return <section className="session-canvas-panel canvas-panel-body" aria-label={title}
    onPointerDownCapture={() => focus(panelId)} onFocusCapture={() => focus(panelId)}>
    <SessionPane workspace={workspace} contentId={panelId + "-content"} />
  </section>;
});

// Hidden tabs keep their lightweight layout node, but release the conversation
// view and its transport subscription. Drafts and commands live above the layout.
const DockedSession = memo(function DockedSession({ node, close, focus }: {
  node: TabNode; close: (id: string) => void; focus: (id: string) => void;
}) {
  // FlexLayout caches factory output. Observe only the session binding so a
  // sidebar selection updates content without rebuilding it during resizing.
  const subscribe = useCallback((notify: () => void) => {
    const model = node.getModel();
    const changed = (action: Action) => { if (!action.isAdjusting() || action.type !== Actions.ADJUST_WEIGHTS) notify(); };
    model.addChangeListener(changed);
    return () => model.removeChangeListener(changed);
  }, [node]);
  const snapshot = useCallback(() => isCollapsed(node.getParent()) ? "" : sessionIdOf(node), [node]);
  const sessionId = useSyncExternalStore(subscribe, snapshot);
  const [visible, setVisible] = useState(node.isVisible());
  useLayoutEffect(() => {
    node.setEventListener("visibility", ({ visible }: { visible: boolean }) => setVisible(visible));
    setVisible(node.isVisible());
    return () => node.removeEventListener("visibility");
  }, [node]);
  return visible && sessionId ? <CanvasSession sessionId={sessionId} panelId={node.getId()} close={close} focus={focus} /> : null;
});

function CollapseButton({ node }: { node: TabSetNode }) {
  const { t } = useTranslation();
  const Icon = collapseAxis(node) === "vertical" ? ChevronLeft : ChevronUp;
  return <Button variant="ghost" size="icon-sm" aria-label={t("sessions:canvas.collapse")} title={t("sessions:canvas.collapse")}
    onClick={() => collapseGroup(node)}><Icon aria-hidden="true" /></Button>;
}

export default function SessionCanvas({ workspace }: { workspace: SessionWorkspace }) {
  const { t } = useTranslation();
  const preferences = useExperimentalFeatures();
  const [model] = useState(() => {
    const initial = readCanvas();
    selectPanel(initial, workspace.selectedSessionId, workspace.selectedSession?.title || t("sessions:new"));
    return initial;
  });
  const [revision, setRevision] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const cancelDrag = useRef<(() => void) | undefined>(undefined);
  const synchronizing = useRef(false);
  const previousSelection = useRef(workspace.selectedSessionId);
  const latest = useRef({ model, workspace, preferences, t });
  latest.current = { model, workspace, preferences, t };

  useLayoutEffect(() => {
    const changed = (action: Action) => {
      // Live splitter updates are applied by FlexLayout without a parent render
      // or storage write. A single final action commits the proportions.
      if (action.isAdjusting()) return;
      setRevision(value => value + 1);
      setSaveError(!saveCanvas(model));
      if (synchronizing.current) return;
      const selected = focusedTab(model);
      const current = latest.current.workspace;
      if (selected && sessionIdOf(selected) !== current.selectedSessionId) current.selectSession(sessionIdOf(selected), undefined, true, true);
    };
    model.addChangeListener(changed);
    return () => model.removeChangeListener(changed);
  }, [model]);

  useLayoutEffect(() => {
    if (getPanels(model).length) return;
    // Closing the last tab returns to the normal new-conversation composer.
    // Reuse only an empty draft; keep unsent text in its original conversation.
    const { workspace, t } = latest.current;
    const id = workspace.newSession();
    if (id) addPanel(model, id, t("sessions:new"));
  }, [model, revision]);

  useLayoutEffect(() => { syncCollapsedGroups(model); }, [model, revision]);

  const startDrag = useCallback((event: PointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0 || event.isPrimary === false || !container.current) return;
    const { model, workspace, t } = latest.current;
    const panel = getPanels(model).find(panel => panel.sessionId === id);
    const session = workspace.folders.flatMap(folder => folder.sessions).find(session => session.id === id);
    if (!panel && !session && id !== workspace.selectedSessionId) return;
    const title = session?.title || workspace.selectedSession?.title || t("sessions:new");
    cancelDrag.current?.();
    const canvas = container.current;
    cancelDrag.current = beginDockDrag({ event: event.nativeEvent, source: event.currentTarget, canvas, title,
      target: (x, y) => findDockTarget(canvas, model, panel?.panelId, x, y),
      commit: target => {
        if (model !== latest.current.model) return;
        const action = panel ? Actions.moveNode(panel.panelId, target.id, target.location, target.index, true)
          : Actions.addTab(tabJson(id, title), target.id, target.location, target.index, true);
        const group = model.getNodeById(target.id);
        model.doAction(group instanceof TabSetNode && isCollapsed(group) ? Actions.group([expandGroupAction(group), action]) : action);
      },
    });
  }, []);

  const tabPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const splitter = target.closest<HTMLElement>(".flexlayout__splitter");
    if (splitter) {
      cancelDrag.current?.();
      const cancel = beginCollapsedResize(event.nativeEvent, splitter, latest.current.model);
      if (cancel) { cancelDrag.current = cancel; event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (target.closest("button, input, a, [role=button], .flexlayout__tab_button_trailing")) return;
    const tab = target.closest("[role=tab]");
    const marker = tab?.querySelector<HTMLElement>("[data-canvas-tab]");
    const groupMarker = target.closest(".flexlayout__tabset_tabbar_outer")?.querySelector<HTMLElement>("[data-canvas-group]");
    const node = marker?.dataset.canvasTab ? latest.current.model.getNodeById(marker.dataset.canvasTab)
      : groupMarker?.dataset.canvasGroup ? (latest.current.model.getNodeById(groupMarker.dataset.canvasGroup) as TabSetNode)?.getSelectedNode() : undefined;
    if (node instanceof TabNode) startDrag(event, sessionIdOf(node));
  }, [startDrag]);

  useEffect(() => () => cancelDrag.current?.(), [model]);

  useLayoutEffect(() => {
    const ref = preferences.sessionDragHandler;
    ref.current = startDrag;
    return () => { if (ref.current === startDrag) ref.current = undefined; };
  }, [preferences.sessionDragHandler, startDrag]);

  useEffect(() => {
    synchronizing.current = true;
    try {
      const actions: Action[] = [];
      for (const panel of getPanels(model)) {
        const replacement = workspace.replacements[panel.sessionId];
        if (workspace.deletedIds.has(panel.sessionId)) actions.push(Actions.deleteTab(panel.panelId));
        else if (replacement) actions.push(Actions.updateNodeAttributes(panel.panelId, { config: { sessionId: replacement } }));
      }
      if (actions.length) model.doAction(Actions.group(actions));
      if (previousSelection.current !== workspace.selectedSessionId) {
        previousSelection.current = workspace.selectedSessionId;
        selectPanel(model, workspace.selectedSessionId, workspace.selectedSession?.title || t("sessions:new"));
      }
      const names: Action[] = [];
      for (const panel of getPanels(model)) {
        const session = workspace.folders.flatMap(folder => folder.sessions).find(session => session.id === panel.sessionId);
        const name = session?.title || (panel.sessionId === workspace.selectedSessionId ? workspace.selectedSession?.title : undefined) || t("sessions:new");
        const node = model.getNodeById(panel.panelId) as TabNode;
        if (node.getName() !== name) names.push(Actions.updateNodeAttributes(panel.panelId, { name }));
      }
      if (names.length) model.doAction(Actions.group(names));
    } finally { synchronizing.current = false; }
  }, [model, workspace.selectedSessionId, workspace.deletedIds, workspace.replacements, workspace.folders, workspace.selectedSession?.title, t]);

  const focus = useCallback((id: string) => {
    const { model, workspace } = latest.current;
    focusPanel(model, id);
    const node = model.getNodeById(id);
    if (node instanceof TabNode && sessionIdOf(node) !== workspace.selectedSessionId) workspace.selectSession(sessionIdOf(node), undefined, true, true);
  }, []);
  const close = useCallback((id: string) => removePanel(latest.current.model, id), []);
  const add = useCallback((id: string) => {
    const { model, workspace, t } = latest.current;
    const session = workspace.folders.flatMap(folder => folder.sessions).find(session => session.id === id);
    if (!session && id !== workspace.selectedSessionId) return;
    const panelId = addPanel(model, id, session?.title || workspace.selectedSession?.title || t("sessions:new"));
    if (panelId) focus(panelId);
  }, [focus]);
  useEffect(() => {
    if (!preferences.addition) return;
    add(preferences.addition.sessionId);
    preferences.setAddition(undefined);
  }, [preferences, add]);

  const factory = useCallback((node: TabNode) => <DockedSession node={node} close={close} focus={focus} />, [close, focus]);
  const renderGroup = useCallback((node: unknown, values: ITabSetRenderValues) => {
    if (!(node instanceof TabSetNode)) return;
    values.leading = <div data-canvas-group={node.getId()}>
      {isCollapsed(node) ? <div className="canvas-collapsed-titles" role="group" aria-label={t("sessions:canvas.collapsedSessions")}>
        {node.getTabNodes().map(tab => <button key={tab.getId()} type="button" className="canvas-collapsed-title"
          data-selected={tab.isSelected()} title={t("sessions:canvas.expandNamed", { title: tab.getName() })}
          aria-label={t("sessions:canvas.expandNamed", { title: tab.getName() })} onClick={() => focus(tab.getId())}>
          <MessageSquare aria-hidden="true" /><span>{tab.getName()}</span>
        </button>)}
      </div> : null}
    </div>;
    if (!isCollapsed(node)) values.buttons.push(<CollapseButton key="collapse" node={node} />);
  }, [focus, t]);
  const translate = useCallback((key: string) => {
    switch (key) {
      case I18nLabel.Close_Tab: return t("sessions:canvas.closeTab");
      case I18nLabel.Close_Tabset: return t("sessions:canvas.closeGroup");
      case I18nLabel.Move_Tabset: case I18nLabel.Move_Tabs: return t("sessions:canvas.moveTabs");
      case I18nLabel.Maximize: return t("sessions:canvas.maximize");
      case I18nLabel.Restore: return t("sessions:canvas.restore");
      case I18nLabel.Overflow_Menu_Tooltip: return t("sessions:canvas.openSessions");
      case I18nLabel.Splitter: return t("sessions:canvas.splitter");
      case I18nLabel.Error_rendering_component: return t("sessions:canvas.failed");
      case I18nLabel.Error_rendering_component_retry: return t("sessions:retryHistory");
      default: return key;
    }
  }, [t]);
  const panels = getPanels(model);
  const minimum = minimumSize(model.getMaximizedTabset() ?? model.getRootRow());

  return <div id="session-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
    {saveError && <p role="status" className="shrink-0 px-4 py-2 text-xs text-muted-foreground">{t("sessions:canvas.saveFailed")}</p>}
    <div ref={container} className="session-canvas relative flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
      onPointerDownCapture={tabPointerDown} onDragStartCapture={event => {
        if ((event.target as HTMLElement).closest(".flexlayout__tabset_tabbar_outer")) event.preventDefault();
      }}>
      <div className="canvas-layout-surface relative w-full flex-1 shrink-0" style={{ minWidth: Math.max(220, minimum.width), minHeight: Math.max(220, minimum.height) }}>
      {panels.length > 0 && <Layout model={model} factory={factory} icons={layoutIcons} realtimeResize
        invalidateTabContentOnParentRender={false} supportsPopout={false} tabDragSpeed={0.12}
        onRenderTab={(node, values) => { values.leading = <span data-canvas-tab={node.getId()}><MessageSquare className="size-icon shrink-0" aria-hidden="true" /></span>; }}
        onRenderTabSet={renderGroup} i18nTranslator={translate}
        onContextMenu={(_node, event) => event.preventDefault()}
        keyMap={{ renameTab: undefined, focusTabToggle: "F6" }} />}
      </div>
    </div>
  </div>;
}
