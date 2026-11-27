import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import type { SessionView } from "@/features/sessions/api";
import type { SessionGateway } from "@/features/sessions/application/session-gateway";
import { SessionGatewayProvider } from "@/features/sessions/application/session-gateway-provider";
import { SessionNotifications } from "@/features/sessions/application/session-notifications";
import { useSessionNotifications } from "@/features/sessions/use-session-notifications";

const snapshot = (sequence: number, busy = false): SessionView => ({
  instanceId: "server", sequence, modelId: "model",
  session: { id: "one", title: "Test conversation", projectId: "project", workspaceRoot: "/work", updatedAt: "", status: busy ? "running" : "ready" },
  state: { busy, canSend: !busy, status: "Ready", phase: busy ? "thinking" : "idle", permissionMode: "ask", closing: false, settingsSaving: false, messages: [] },
});
const completed = (sequence: number, status = "completed"): SessionView => ({ ...snapshot(sequence), state: {
  ...snapshot(sequence).state, lastRunStatus: status,
  messages: [{ id: "answer", role: "assistant", text: "Done", completion: { completedAt: sequence, durationMs: 100, status } }],
} });
const approval = (sequence: number, approvalId = "approval-1"): SessionView => ({ ...snapshot(sequence, true), approvalId,
  state: { ...snapshot(sequence, true).state, approval: { name: "run_command", preview: { type: "tool" } } },
});

afterEach(() => { delete window.alphacodeDesktop; });

it("does not alert for historical completions, duplicate or stale snapshots, or cancellations", () => {
  const tracker = new SessionNotifications();
  expect(tracker.receive(completed(1))).toBeUndefined();
  tracker.receive(snapshot(2, true));
  expect(tracker.receive(completed(3))).toBe("completed");
  expect(tracker.receive(completed(3))).toBeUndefined();
  expect(tracker.receive(snapshot(2, true))).toBeUndefined();
  expect(tracker.receive(completed(4, "cancelled"))).toBeUndefined();
  expect(tracker.receive({ ...completed(5), instanceId: "restarted" })).toBeUndefined();
});

it("alerts once for each approval and reports failed runs", () => {
  const tracker = new SessionNotifications();
  expect(tracker.receive(approval(1))).toBe("approval");
  expect(tracker.receive(approval(2))).toBeUndefined();
  expect(tracker.receive(approval(3, "approval-2"))).toBe("approval");
  expect(tracker.receive(completed(4, "failed"))).toBe("failed");
});

it("keeps a running session subscribed without a conversation pane, routes clicks and cleans up", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const notify = vi.fn();
  const unsubscribeClick = vi.fn();
  let click: ((id: string) => void) | undefined;
  window.alphacodeDesktop = { platform: "win32", setAppearance: vi.fn(), notify,
    onNotificationClick: listener => { click = listener; return unsubscribeClick; } };
  let receive: ((view: SessionView) => void) | undefined;
  let signal: AbortSignal | undefined;
  const gateway = { subscribeSession: vi.fn(async (_id, listener, abort) => {
    receive = listener;
    signal = abort;
  }) } as unknown as SessionGateway;
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>
    <SessionGatewayProvider gateway={gateway}><MemoryRouter initialEntries={["/settings"]}>{children}</MemoryRouter></SessionGatewayProvider>
  </QueryClientProvider>;
  const { result, unmount } = renderHook(() => { useSessionNotifications(); return useLocation(); }, { wrapper });
  act(() => { client.setQueryData(["session", "one"], snapshot(1, true)); });
  expect(gateway.subscribeSession).toHaveBeenCalledTimes(1);
  act(() => { receive?.(approval(2)); });
  expect(notify).toHaveBeenLastCalledWith({ sessionId: "one", title: "Test conversation", kind: "approval" });
  act(() => { receive?.(completed(3)); });
  expect(notify).toHaveBeenCalledTimes(2);
  expect(signal?.aborted).toBe(true);
  act(() => { click?.("one"); });
  expect(result.current.pathname + result.current.search).toBe("/?session=one");
  unmount();
  expect(unsubscribeClick).toHaveBeenCalled();
  client.clear();
});
