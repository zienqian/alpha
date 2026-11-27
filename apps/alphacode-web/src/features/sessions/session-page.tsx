import { Component, type ReactNode } from "react";
import { useOutletContext } from "react-router";
import { useTranslation } from "@/i18n/react";
import SessionCanvas from "@/features/session-canvas/session-canvas";
import type { SessionWorkspace } from "./use-session-workspace";
import { SessionPane } from "./session-pane";

class CanvasBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function SessionPage() {
  const workspace = useOutletContext<SessionWorkspace>();
  const { t } = useTranslation();
  return <CanvasBoundary fallback={<>
    <div role="alert" className="flex items-center gap-3 px-4 py-3 text-xs"><span>{t("sessions:canvas.failed")}</span></div>
    <SessionPane workspace={workspace} />
  </>}><SessionCanvas workspace={workspace} /></CanvasBoundary>;
}
