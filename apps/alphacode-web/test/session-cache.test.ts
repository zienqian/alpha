import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { SessionView } from "@/features/sessions/api";
import { cacheSession, sessionKeys, shareSessionSnapshot } from "@/features/sessions/application/session-cache";
import { mockSessionApi } from "./fixtures/session-api";

describe("session snapshot cache", () => {
  it("protects inactive sessions from stale command refreshes without relying on a mounted query", () => {
    const api = mockSessionApi();
    const client = new QueryClient();
    const current = structuredClone(api.view("project-notes"));
    current.sequence = 20;
    cacheSession(client, current);
    cacheSession(client, { ...current, sequence: 10, state: { ...current.state, messages: [] } });
    expect(client.getQueryData(sessionKeys.detail(current.session.id))).toBe(current);
    client.clear();
  });

  it("accepts new server instances and preserves unchanged subtrees during normal updates", () => {
    const api = mockSessionApi();
    const current = structuredClone(api.view("project-notes"));
    current.sequence = 20;
    const next = shareSessionSnapshot(current, { ...structuredClone(current), sequence: 21 }) as SessionView;
    expect(next.sequence).toBe(21);
    expect(next.state).toBe(current.state);
    const restarted = shareSessionSnapshot(next, { ...current, instanceId: "restarted", sequence: 0 }) as SessionView;
    expect(restarted.instanceId).toBe("restarted");
    expect(restarted.sequence).toBe(0);
  });
});
