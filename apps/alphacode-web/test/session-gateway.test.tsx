import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";
import { AppProviders } from "@/components/providers";
import type { SessionView } from "@/features/sessions/api";
import type { SessionGateway } from "@/features/sessions/application/session-gateway";
import { useSessionQuery } from "@/features/sessions/queries";
import { useSessionActions } from "@/features/sessions/use-session-actions";
import { useSessionSearch } from "@/features/sessions/application/use-session-search";

it("injects query, stream, command and search capabilities without using the HTTP implementation", async () => {
  const fetch = vi.fn(() => { throw new Error("Unexpected network request"); });
  vi.stubGlobal("fetch", fetch);
  const snapshot = (id: string): SessionView => ({
    instanceId: "in-memory", sequence: 1, modelId: "model",
    session: { id, projectId: "project", workspaceRoot: "/work", title: id, updatedAt: "", status: "ready" },
    state: { messages: [], busy: false, status: "ready", canSend: true, closing: false,
      settingsSaving: false, phase: "idle", permissionMode: "ask" },
  });
  const subscriptions = new Map<string, { receive: (view: SessionView) => void; signal: AbortSignal }>();
  const gateway = {
    list: vi.fn<SessionGateway["list"]>(async () => [snapshot("one").session]),
    get: vi.fn<SessionGateway["get"]>(async id => snapshot(id)),
    search: vi.fn<SessionGateway["search"]>(async () => [{ session: snapshot("one").session, snippets: [], matchCount: 0 }]),
    send: vi.fn<SessionGateway["send"]>(async (_id, requestId) => ({ requestId, status: "accepted" })),
    cancel: vi.fn<SessionGateway["cancel"]>(async () => undefined),
    answerApproval: vi.fn<SessionGateway["answerApproval"]>(async () => undefined),
    subscribeIndex: vi.fn<SessionGateway["subscribeIndex"]>(async () => undefined),
    subscribeSession: vi.fn<SessionGateway["subscribeSession"]>(async (id, receive, signal, connection) => {
      subscriptions.set(id, { receive, signal });
      receive(snapshot(id));
      connection("connected");
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    }),
  } satisfies SessionGateway;
  const accepted = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => <StrictMode><AppProviders sessionGateway={gateway}>{children}</AppProviders></StrictMode>;
  const { result, rerender, unmount } = renderHook(({ id }) => {
    const history = useSessionQuery(id);
    const actions = useSessionActions(history.data, id, accepted);
    const search = useSessionSearch([]);
    return { history, actions, search };
  }, { initialProps: { id: "one" }, wrapper });

  await waitFor(() => expect(result.current.history.connection).toBe("connected"));
  await act(async () => { await result.current.actions.send("one", "hello"); });
  expect(gateway.send).toHaveBeenCalledExactlyOnceWith("one", expect.any(String), "hello");
  expect(accepted).toHaveBeenCalledWith("one", "hello");
  expect(result.current.actions.pending?.status).toBe("accepted");
  const original = subscriptions.get("one");
  act(() => { original?.receive({ ...snapshot("one"), sequence: 2 }); });
  await waitFor(() => expect(result.current.actions.pending).toBeUndefined());
  act(() => { original?.receive(snapshot("one")); });
  expect(result.current.history.data?.sequence).toBe(2);

  act(() => result.current.search.setInput("hello"));
  await waitFor(() => expect(result.current.search.results).toHaveLength(1));
  expect(gateway.search).toHaveBeenCalledWith("hello", expect.any(AbortSignal));
  rerender({ id: "two" });
  await waitFor(() => expect(result.current.history.data?.session.id).toBe("two"));
  expect(original?.signal.aborted).toBe(true);
  await waitFor(() => expect(subscriptions.has("two")).toBe(true));
  unmount();
  expect(subscriptions.get("two")?.signal.aborted).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
