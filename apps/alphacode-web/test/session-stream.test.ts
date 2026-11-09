import { describe, expect, it, vi } from "vitest";
import { subscribeSnapshots } from "@/features/sessions/stream";

const encoder = new TextEncoder();
describe("snapshot transport", () => {
  it("decodes split UTF-8, CRLF, multiple data lines and multiple events; abort releases the stream", async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    const bytes = encoder.encode(': heartbeat\r\nid: 1\r\ndata:{"text":\r\ndata: "汉字"}\r\n\r\ndata: {"text":"next"}\n\n');
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); }, cancel,
    }), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const values: unknown[] = [];
    await subscribeSnapshots("/events", (value) => { values.push(value); if (values.length === 2) abort.abort(); }, abort.signal);
    expect(values).toEqual([{ text: "汉字" }, { text: "next" }]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/events", expect.objectContaining({ credentials: "omit", redirect: "error", headers: { Accept: "text/event-stream" } }));
  });

  it("reconnects after EOF using a new full snapshot", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const response = (sequence: number) => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(`data: {"sequence":${sequence}}\n\n`)); controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } });
    const fetch = vi.fn().mockResolvedValueOnce(response(1)).mockResolvedValueOnce(response(2));
    vi.stubGlobal("fetch", fetch);
    const values: unknown[] = [];
    const status = vi.fn();
    try {
      const task = subscribeSnapshots<{ sequence: number }>("/events", value => {
        values.push(value); if (value.sequence === 2) abort.abort();
      }, abort.signal, status);
      await vi.advanceTimersByTimeAsync(750);
      await task;
      expect(values).toEqual([{ sequence: 1 }, { sequence: 2 }]);
      expect(status).toHaveBeenCalledWith("reconnecting");
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { abort.abort(); vi.useRealTimers(); }
  });

  it("does not retry a forbidden stream or parse an HTML dev-server response as SSE", async () => {
    const abort = new AbortController();
    const status = vi.fn();
    const fetch = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await subscribeSnapshots("/events", vi.fn(), abort.signal, status);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith("error");
    fetch.mockResolvedValue(new Response("<html/>", { headers: { "Content-Type": "text/html" } }));
    const receive = vi.fn();
    await subscribeSnapshots("/events", receive, abort.signal, state => { if (state === "reconnecting") abort.abort(); });
    expect(receive).not.toHaveBeenCalled();
  });
});
