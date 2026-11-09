import { SessionApiError } from "@/features/sessions/api";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "error";

// Fetch keeps the same credential/redirect policy as JSON requests. Each
// connection starts with a full snapshot; there is no delta replay to merge.
export async function subscribeSnapshots<T>(path: string, receive: (value: T) => void,
  signal: AbortSignal, connection: (status: ConnectionStatus) => void = () => undefined) {
  let retryMs = 750;
  while (!signal.aborted) {
    const attempt = new AbortController();
    const abort = () => attempt.abort();
    signal.addEventListener("abort", abort, { once: true });
    let watchdog = setTimeout(abort, 45_000);
    try {
      const response = await fetch(path, {
        signal: attempt.signal, credentials: "omit", redirect: "error", cache: "no-store",
        headers: { Accept: "text/event-stream" },
      });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        await response.body?.cancel();
        throw new SessionApiError(response.status, "STREAM_UNAVAILABLE");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          clearTimeout(watchdog);
          watchdog = setTimeout(abort, 45_000);
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary: RegExpExecArray | null;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const event = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            const data = event.split(/\r?\n/).filter(line => line === "data" || line.startsWith("data:"))
              .map(line => line.slice(5).replace(/^ /, "")).join("\n");
            if (data && !signal.aborted) {
              receive(JSON.parse(data) as T);
              connection("connected");
              retryMs = 750;
            }
          }
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    } catch (error) {
      if (!signal.aborted && error instanceof SessionApiError && [401, 403, 404].includes(error.status)) {
        connection("error");
        return;
      }
    } finally {
      clearTimeout(watchdog);
      signal.removeEventListener("abort", abort);
      attempt.abort();
    }
    if (signal.aborted) return;
    connection("reconnecting");
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, retryMs);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    });
    retryMs = Math.min(retryMs * 2, 10_000);
  }
}
