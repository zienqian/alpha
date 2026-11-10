import { describe, expect, it, vi } from "vitest";
import { SessionApiError, type RequestReceipt, type SessionView } from "@/features/sessions/api";
import { SessionCommands } from "@/features/sessions/application/session-commands";
import type { SessionGateway } from "@/features/sessions/application/session-gateway";
import { latestSnapshot } from "@/features/sessions/domain/request";

function view(id = "one", sequence = 1, instanceId = "server"): SessionView {
  return {
    instanceId, sequence, modelId: "model",
    session: { id, projectId: "project", workspaceRoot: "/work", title: id, updatedAt: "", status: "ready" },
    state: { messages: [], busy: false, status: "ready", canSend: true, closing: false,
      settingsSaving: false, phase: "idle", permissionMode: "ask" },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const snapshots = new Map<string, SessionView>([["one", view()], ["two", view("two")]]);
  const gateway = {
    get: vi.fn(async (id: string) => {
      const snapshot = snapshots.get(id);
      if (!snapshot) throw new Error(`Missing session: ${id}`);
      return snapshot;
    }),
    send: vi.fn<SessionGateway["send"]>(async (_id, requestId) => ({ requestId, status: "accepted" })),
    cancel: vi.fn(async () => undefined),
    answerApproval: vi.fn(async () => undefined),
  };
  const accepted = vi.fn();
  const invalidateList = vi.fn();
  const commands = new SessionCommands(gateway, {
    get: id => snapshots.get(id),
    write: next => { snapshots.set(next.session.id, latestSnapshot(snapshots.get(next.session.id), next)); },
    invalidateList,
  }, accepted);
  return { commands, gateway, snapshots, accepted, invalidateList };
}

describe("session commands", () => {
  it("locks duplicate sends per session while allowing another session to submit", async () => {
    const { commands, gateway, accepted } = setup();
    const receipt = deferred<RequestReceipt>();
    gateway.send.mockReturnValueOnce(receipt.promise);
    const first = commands.send("one", "first");
    await commands.send("one", "duplicate");
    await commands.send("two", "independent");
    expect(gateway.send).toHaveBeenCalledTimes(2);
    expect(commands.getState("one").pending?.status).toBe("sending");
    receipt.resolve({ requestId: "receipt", status: "accepted" });
    await first;
    expect(accepted.mock.calls).toEqual([["two", "independent"], ["one", "first"]]);
    expect(commands.getState("one").pending?.status).toBe("accepted");
  });

  it.each([new TypeError("offline"), new SessionApiError(503, "UNAVAILABLE"), new SessionApiError(409, "SESSION_BUSY")])(
    "reuses request identity and original input after an uncertain admission: %s", async cause => {
      const { commands, gateway, accepted } = setup();
      gateway.send.mockRejectedValueOnce(cause);
      await commands.send("one", "original");
      expect(commands.getState("one").pending?.status).toBe("uncertain");
      expect(accepted).not.toHaveBeenCalled();
      await commands.send("one", "edited draft");
      expect(gateway.send.mock.calls[1]).toEqual(gateway.send.mock.calls[0]);
      expect(accepted).toHaveBeenCalledWith("one", "original");
      expect(commands.getState("one").error).toBeUndefined();
    },
  );

  it("allows a new request after a definite rejection without accepting the rejected draft", async () => {
    const { commands, gateway, accepted } = setup();
    gateway.send.mockRejectedValueOnce(new SessionApiError(400, "INVALID_INPUT"));
    await commands.send("one", "invalid");
    expect(commands.getState("one").pending).toBeUndefined();
    expect(accepted).not.toHaveBeenCalled();
    await commands.send("one", "corrected");
    expect(gateway.send.mock.calls[1]?.[1]).not.toBe(gateway.send.mock.calls[0]?.[1]);
    expect(accepted).toHaveBeenCalledWith("one", "corrected");
  });

  it("reports interrupted receipts without clearing the draft", async () => {
    const { commands, gateway, accepted } = setup();
    gateway.send.mockResolvedValueOnce({ requestId: "interrupted", status: "interrupted" });
    await commands.send("one", "keep");
    expect(commands.getState("one")).toMatchObject({ pending: undefined, error: { kind: "interrupted" } });
    expect(accepted).not.toHaveBeenCalled();
  });

  it("waits for admission before clearing pending state even if SSE arrives first", async () => {
    const { commands, gateway, snapshots } = setup();
    const receipt = deferred<RequestReceipt>();
    gateway.send.mockReturnValueOnce(receipt.promise);
    const sending = commands.send("one", "hello");
    snapshots.set("one", view("one", 2));
    commands.observe(snapshots.get("one"));
    expect(commands.getState("one").pending?.status).toBe("sending");
    receipt.resolve({ requestId: "accepted", status: "accepted" });
    await sending;
    expect(commands.getState("one").pending).toBeUndefined();
  });

  it("settles accepted state from a refresh even when its session is no longer selected", async () => {
    const { commands, gateway } = setup();
    gateway.get.mockResolvedValueOnce(view("one", 2));
    await commands.send("one", "hello");
    await vi.waitFor(() => expect(commands.getState("one").pending).toBeUndefined());
    expect(commands.getState("two").pending).toBeUndefined();
  });

  it("retains admission until an advanced snapshot or new server instance is observed", async () => {
    const { commands } = setup();
    await commands.send("one", "hello");
    commands.observe(view("two", 20));
    commands.observe(view("one", 0));
    commands.observe(view("one", 1));
    expect(commands.getState("one").pending?.status).toBe("accepted");
    commands.observe(view("one", 0, "restarted"));
    expect(commands.getState("one").pending).toBeUndefined();
  });

  it("keeps approval identity stable, excludes duplicate controls and rejects mismatched sessions", async () => {
    const { commands, gateway } = setup();
    const approved = deferred<undefined>();
    gateway.answerApproval.mockReturnValueOnce(approved.promise);
    const snapshot = { ...view(), requestId: "request-1", approvalId: "approval-1" };
    const control = commands.control("one", snapshot, "approval", true);
    await commands.control("one", snapshot, "cancel");
    await commands.control("two", snapshot, "approval", false);
    expect(gateway.answerApproval).toHaveBeenCalledExactlyOnceWith("one", "request-1", "approval-1", true);
    expect(gateway.cancel).not.toHaveBeenCalled();
    expect(commands.getState("one").controlling).toBe(true);
    approved.resolve(undefined);
    await control;
    expect(commands.getState("one").controlling).toBe(false);
    await commands.control("one", { ...snapshot, approvalId: undefined }, "approval", true);
    expect(gateway.answerApproval).toHaveBeenCalledTimes(1);
  });

  it("releases failed controls even when refreshing also fails", async () => {
    const { commands, gateway } = setup();
    gateway.cancel.mockRejectedValueOnce(new SessionApiError(409, "STALE_REQUEST"));
    gateway.get.mockRejectedValueOnce(new TypeError("offline"));
    const snapshot = { ...view(), requestId: "request-1" };
    await commands.control("one", snapshot, "cancel");
    expect(commands.getState("one")).toMatchObject({ controlling: false, error: { cause: expect.any(SessionApiError) } });
    await commands.control("one", snapshot, "cancel");
    expect(gateway.cancel).toHaveBeenCalledTimes(2);
    expect(commands.getState("one").error).toBeUndefined();
  });
});
