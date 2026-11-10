import type { TraceStore } from "../contracts";
import { Worker } from "node:worker_threads";
import { failure } from "../internal";

/** All synchronous SQLite work runs off the Agent's event loop. */
export async function createSqliteTraceStore(options: {
  filename: string;
  retentionDays?: number;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<TraceStore> {
  if (
    !options.filename ||
    options.filename === ":memory:" ||
    options.filename.includes("\0")
  )
    throw failure("TRACE_CONFIG_INVALID");
  const timeoutMs = options.timeoutMs ?? 5000;
  const worker = new Worker(
    new URL(
      import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js",
      import.meta.url,
    ),
  );
  worker.unref();
  let next = 0,
    closed = false,
    broken = false;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function failAll(code: string) {
    broken = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(failure(code));
    }
    pending.clear();
  }
  worker.on(
    "message",
    (data: { id: number; value?: unknown; error?: string }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      clearTimeout(entry.timer);
      if (data.error) entry.reject(failure(data.error));
      else entry.resolve(data.value);
    },
  );
  worker.on("error", () => failAll("TRACE_WORKER_FAILED"));
  worker.on("exit", () => {
    if (!closed) failAll("TRACE_WORKER_FAILED");
  });
  function request<T>(op: string, args: unknown): Promise<T> {
    if (closed || broken) return Promise.reject(failure("TRACE_STORE_CLOSED"));
    const id = ++next;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(failure("TRACE_STORE_TIMEOUT"));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        worker.postMessage({ id, op, args });
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(failure("TRACE_WORKER_FAILED"));
      }
    });
  }
  try {
    await request("init", options);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  return {
    durability: "transactional",
    write: (snapshots) => request("write", snapshots),
    read: (scope, traceId) => request("read", { scope, traceId }),
    findByReply: (scope, replyId) => request("findByReply", { scope, replyId }),
    list: (scope, options) => request("list", { scope, options }),
    deleteSession: (scope) => request("deleteSession", scope),
    async close() {
      if (closed) return;
      try {
        if (!broken) await request("close", null);
      } finally {
        closed = true;
        failAll("TRACE_STORE_CLOSED");
        worker.terminate();
      }
    },
  };
}
