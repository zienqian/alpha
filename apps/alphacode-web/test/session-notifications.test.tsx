import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
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
const completed = (sequence: number, status = "completed", messageId = `answer-${sequence}`, completedAt = sequence): SessionView => ({ ...snapshot(sequence), state: {
  ...snapshot(sequence).state, lastRunStatus: status,
  messages: [{ id: messageId, role: "assistant", text: "Done", completion: { completedAt, durationMs: 100, status } }],
} });
const approval = (sequence: number, approvalId = "approval-1"): SessionView => ({ ...snapshot(sequence, true), approvalId,
  state: { ...snapshot(sequence, true).state, approval: { name: "run_command", preview: { type: "tool" } } },
});

afterEach(() => {
  delete window.alphacodeDesktop;
  vi.restoreAllMocks();
});

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

it("waits until request finalization and queued follow-ups finish, and ignores local commands or cancelled queue items", () => {
  const tracker = new SessionNotifications();
  expect(tracker.receive(completed(1, "completed", "turn-1", 1000))).toBeUndefined();

  // Queueing a follow-up and cancelling it before execution must not re-alert Turn 1.
  expect(tracker.receive({
    ...completed(2, "completed", "turn-1", 1000),
    state: { ...completed(2, "completed", "turn-1", 1000).state, queuedRequests: [{ requestId: "req-q", input: "follow up" }] },
  })).toBeUndefined();
  expect(tracker.receive(completed(3, "completed", "turn-1", 1000))).toBeUndefined();

  // Local slash commands toggle busy with lastRunStatus="completed" but emit no turn completion record.
  expect(tracker.receive(snapshot(4, true))).toBeUndefined();
  expect(tracker.receive({
    ...snapshot(5, false),
    state: {
      ...snapshot(5, false).state,
      lastRunStatus: "completed",
      messages: [{ id: "local-1", role: "assistant", text: "Skills", localResult: { kind: "skills" } }],
    },
  })).toBeUndefined();

  // A turn with an active requestId or queued follow-ups must not alert mid-task.
  expect(tracker.receive({ ...snapshot(6, true), requestId: "req-1", state: { ...snapshot(6, true).state, queuedRequests: [{ requestId: "req-2", input: "next" }] } })).toBeUndefined();
  expect(tracker.receive({ ...completed(7, "completed", "turn-2", 2000), requestId: "req-1", state: { ...completed(7, "completed", "turn-2", 2000).state, queuedRequests: [{ requestId: "req-2", input: "next" }] } })).toBeUndefined();
  expect(tracker.receive({ ...completed(8, "completed", "turn-2", 2000), state: { ...completed(8, "completed", "turn-2", 2000).state, queuedRequests: [{ requestId: "req-2", input: "next" }] } })).toBeUndefined();
  expect(tracker.receive({ ...snapshot(9, true), requestId: "req-2" })).toBeUndefined();
  expect(tracker.receive({ ...completed(10, "completed", "turn-3", 3000), requestId: "req-2" })).toBeUndefined();
  expect(tracker.receive(completed(11, "completed", "turn-3", 3000))).toBe("completed");
  expect(tracker.receive(completed(12, "completed", "turn-3", 3000))).toBeUndefined();
});

it("alerts once for each active approval, ignores stopping or seeded approvals, and reports failed or blocked runs", () => {
  const tracker = new SessionNotifications();
  tracker.seed(approval(1, "seeded-approval"));
  expect(tracker.receive(approval(2, "seeded-approval"))).toBeUndefined();
  expect(tracker.receive({
    ...approval(3, "stopping-approval"),
    state: { ...approval(3, "stopping-approval").state, phase: "stopping" },
  })).toBeUndefined();
  expect(tracker.receive(approval(4, "approval-2"))).toBe("approval");
  expect(tracker.receive(approval(5, "approval-2"))).toBeUndefined();
  expect(tracker.receive(completed(6, "failed"))).toBe("failed");
  expect(tracker.receive({
    ...completed(7, "completed"),
    session: { ...completed(7, "completed").session, status: "blocked" },
  })).toBe("failed");
});

it("suppresses desktop notifications while the window is focused without replaying them later", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const notify = vi.fn();
  window.alphacodeDesktop = { platform: "win32", setAppearance: vi.fn(), notify };
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  let receive: ((view: SessionView) => void) | undefined;
  const gateway = { subscribeSession: vi.fn(async (_id, listener) => { receive = listener; }) } as unknown as SessionGateway;
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>
    <SessionGatewayProvider gateway={gateway}><MemoryRouter>{children}</MemoryRouter></SessionGatewayProvider>
  </QueryClientProvider>;
  const { unmount } = renderHook(() => { useSessionNotifications(); }, { wrapper });

  act(() => { client.setQueryData(["session", "one"], snapshot(1, true)); });
  act(() => { receive?.(approval(2)); });
  act(() => { receive?.(completed(3, "completed", "turn-1", 1000)); });
  expect(notify).not.toHaveBeenCalled();

  // Losing focus later must not replay already-observed completions, while new background turns notify.
  hasFocus.mockReturnValue(false);
  act(() => { client.setQueryData(["session", "one"], { ...completed(4, "completed", "turn-1", 1000), session: { ...completed(4).session, title: "Renamed" } }); });
  expect(notify).not.toHaveBeenCalled();
  act(() => { client.setQueryData(["session", "one"], snapshot(5, true)); });
  act(() => { receive?.(completed(6, "completed", "turn-2", 2000)); });
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenLastCalledWith({ sessionId: "one", title: "Test conversation", kind: "completed" });

  unmount();
  client.clear();
});

it("keeps a running session subscribed across route changes, routes clicks when unfocused, and cleans up", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const notify = vi.fn();
  const unsubscribeClick = vi.fn();
  let click: ((id: string) => void) | undefined;
  window.alphacodeDesktop = { platform: "win32", setAppearance: vi.fn(), notify,
    onNotificationClick: listener => { click = listener; return unsubscribeClick; } };
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  let receive: ((view: SessionView) => void) | undefined;
  let signal: AbortSignal | undefined;
  const gateway = { subscribeSession: vi.fn(async (_id, listener, abort) => {
    receive = listener;
    signal = abort;
  }) } as unknown as SessionGateway;
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>
    <SessionGatewayProvider gateway={gateway}><MemoryRouter initialEntries={["/settings"]}>{children}</MemoryRouter></SessionGatewayProvider>
  </QueryClientProvider>;
  const { result, unmount } = renderHook(() => {
    useSessionNotifications();
    return { location: useLocation(), navigate: useNavigate() };
  }, { wrapper });
  act(() => { client.setQueryData(["session", "one"], snapshot(1, true)); });
  expect(gateway.subscribeSession).toHaveBeenCalledTimes(1);
  act(() => { receive?.(approval(2)); });
  expect(notify).toHaveBeenLastCalledWith({ sessionId: "one", title: "Test conversation", kind: "approval" });

  // Route changes must not tear down the stream or re-alert for the same approval.
  act(() => { void result.current.navigate("/skills"); });
  expect(signal?.aborted).toBe(false);
  expect(gateway.subscribeSession).toHaveBeenCalledTimes(1);
  act(() => { receive?.(approval(3)); });
  expect(notify).toHaveBeenCalledTimes(1);

  // Brief idle gap with a queued follow-up keeps the stream subscribed and defers completion alert.
  act(() => { receive?.({ ...completed(4, "completed", "turn-1", 1000), state: { ...completed(4, "completed", "turn-1", 1000).state, queuedRequests: [{ requestId: "req-2", input: "next" }] } }); });
  expect(signal?.aborted).toBe(false);
  expect(notify).toHaveBeenCalledTimes(1);
  act(() => { receive?.(completed(5, "completed", "turn-2", 2000)); });
  expect(notify).toHaveBeenCalledTimes(2);
  expect(notify).toHaveBeenLastCalledWith({ sessionId: "one", title: "Test conversation", kind: "completed" });
  expect(signal?.aborted).toBe(true);
  act(() => { click?.("one"); });
  expect(result.current.location.pathname + result.current.location.search).toBe("/?session=one");
  unmount();
  expect(unsubscribeClick).toHaveBeenCalled();
  client.clear();
});
