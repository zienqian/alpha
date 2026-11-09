export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function createClient(options: {
  origin?: string;
  token?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
} = {}) {
  const send = options.fetch ?? globalThis.fetch;
  const headers = () => ({
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  });
  async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await send(`${options.origin ?? ""}${path}`, {
      method: body === undefined ? "GET" : "POST", credentials: "omit", redirect: "error", signal,
      headers: { ...headers(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { code?: string };
      throw new ApiError(response.status, error.code ?? `HTTP_${response.status}`);
    }
    return await response.json() as T;
  }
  async function subscribe<T>(path: string, receive: (value: T) => void, signal: AbortSignal, connection?: (connected: boolean) => void) {
    while (!signal.aborted) {
      try {
        const response = await send(`${options.origin ?? ""}${path}`, {
          headers: headers(), credentials: "omit", redirect: "error", signal,
        });
        if (!response.ok || !response.body) throw new ApiError(response.status, "STREAM_UNAVAILABLE");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (!signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let boundary: number;
            while ((boundary = buffer.indexOf("\n\n")) !== -1) {
              const event = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const data = event.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
              if (data) { receive(JSON.parse(data) as T); connection?.(true); }
            }
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
          connection?.(false);
          return;
        }
      }
      connection?.(false);
      if (!signal.aborted) await new Promise<void>(resolve => {
        const finished = () => { clearTimeout(timer); signal.removeEventListener("abort", finished); resolve(); };
        const timer = setTimeout(finished, 750);
        signal.addEventListener("abort", finished, { once: true });
      });
    }
  }
  return { request, subscribe };
}

export type AlphaClient = ReturnType<typeof createClient>;
