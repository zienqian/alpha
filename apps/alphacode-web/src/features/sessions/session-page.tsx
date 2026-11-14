import { Component, lazy, Suspense, type ReactNode } from "react";
import { useOutletContext } from "react-router";
import { useTranslation } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { useExperimentalFeatures } from "@/features/settings/experimental-features";
import type { SessionWorkspace } from "./use-session-workspace";
import { HistoryLoading, SessionPane } from "./session-pane";
const SessionCanvas = lazy(() => import("@/features/session-canvas/session-canvas"));

class CanvasBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function SessionPage() {
  const workspace = useOutletContext<SessionWorkspace>();
  const experiments = useExperimentalFeatures();
  const { t } = useTranslation();
  if (experiments.sessionCanvas) return <CanvasBoundary fallback={<>
    <div role="alert" className="flex items-center gap-3 px-4 py-3 text-xs"><span>{t("sessions:canvas.failed")}</span>
      <Button variant="outline" size="sm" onClick={() => experiments.setSessionCanvas(false)}>{t("sessions:canvas.disable")}</Button></div>
    <SessionPane workspace={workspace} />
  </>}><Suspense fallback={<HistoryLoading />}><SessionCanvas workspace={workspace} /></Suspense></CanvasBoundary>;
  return <SessionPane workspace={workspace} />;
}
