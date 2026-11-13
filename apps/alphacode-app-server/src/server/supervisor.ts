import { spawn } from "node:child_process";
import type { ServerDescriptor } from "./lifecycle";
import type { ServerHandoff, UpdateStatus } from "./handoff";
import { codeRevision, serverLayout } from "./revision";
import { protocolVersion } from "./protocol";
import { writeJson } from "./storage";

type Layout = Awaited<ReturnType<typeof serverLayout>>;
interface Options {
  databasePath: string;
  directory: string;
  descriptorPath: string;
  layout: Layout;
  getRevision?: () => Promise<string>;
  pollMs?: number;
  retryMs?: number;
  onIdle?: () => void;
}

function launch(layout: Layout, onEvent: (event: string) => void) {
  const child = spawn(process.execPath, ["--no-env-file", `--config=${layout.config}`, "--conditions=alpha-source", layout.worker], {
    windowsHide: true, stdio: ["ignore", "inherit", "inherit", "ipc"], serialization: "json",
  });
  let id = 0;
  let launchFailed = false;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const exit = Promise.withResolvers<void>();
  const loaded = Promise.withResolvers<void>();
  const loadingTimer = setTimeout(() => loaded.reject(new Error("WORKER_START_TIMEOUT")), 20000);
  const died = () => {
    loaded.reject(new Error("WORKER_EXITED"));
    for (const request of pending.values()) request.reject(new Error("WORKER_EXITED"));
    pending.clear();
  };
  child.on("error", () => { launchFailed = true; exit.resolve(); died(); onEvent("exit"); });
  child.on("exit", () => { exit.resolve(); died(); onEvent("exit"); });
  child.on("message", (message: { id?: number; event?: string; protocolVersion?: number; value?: unknown; error?: string }) => {
    if (message.event === "loaded") {
      if (message.protocolVersion !== protocolVersion) loaded.reject(new Error("SERVER_INCOMPATIBLE"));
      else loaded.resolve();
    } else if (message.event) onEvent(message.event);
    else if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message.value);
    }
  });
  const ready = loaded.promise.finally(() => clearTimeout(loadingTimer));
  async function request<T>(method: string, args: object = {}): Promise<T> {
    await ready;
    const requestId = ++id;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("WORKER_REQUEST_TIMEOUT")); }, 30000);
      pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value as T); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.send({ id: requestId, method, ...args }, error => {
        if (error) { pending.get(requestId)?.reject(error); pending.delete(requestId); }
      });
    });
  }
  const exited = () => launchFailed || child.exitCode !== null || child.signalCode !== null;
  async function dispose() {
    if (child.connected) child.disconnect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exit.promise, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
      // Only a retired or rejected worker reaches disposal. A stuck import must
      // not leave a process behind; never terminate a serving worker this way.
      if (!exited()) child.kill();
      await exit.promise;
    } finally { clearTimeout(timer); }
  }
  return { request, dispose, exited };
}

export async function startSupervisor(options: Options) {
  const revision = options.getRevision ?? (() => codeRevision(options.layout));
  let currentRevision = await revision();
  let observed = currentRevision;
  let failedRevision: string | undefined;
  let retryAt = 0;
  let failures = 0;
  let descriptor: ServerDescriptor;
  let closed = false;
  let checking: Promise<void> | undefined;
  const spawnWorker = () => {
    const worker = launch(options.layout, event => {
      if (worker !== current || closed) return;
      if (event === "idle" || event === "exit") options.onIdle?.();
      if (event === "retry") { retryAt = 0; void check(); }
    });
    return worker;
  };
  let current = spawnWorker();
  const stage = (worker: ReturnType<typeof launch>, value: string) => worker.request("stage", { directory: options.directory, revision: value });
  async function activate(worker: ReturnType<typeof launch>, restore?: ServerHandoff) {
    const value = await worker.request<{ origin: string; token: string; instanceId: string }>("start", {
      databasePath: options.databasePath, directory: options.directory,
      token: descriptor?.token, port: descriptor ? Number(new URL(descriptor.origin).port) : undefined, restore,
    });
    descriptor = { ...value, protocolVersion, pid: process.pid, databasePath: options.databasePath, managed: true, revision: currentRevision };
    await writeJson(options.descriptorPath, descriptor);
    await worker.request("resume");
  }
  try { await stage(current, currentRevision); await activate(current); }
  catch (error) { await current.dispose(); throw error; }
  const status = (value: UpdateStatus) => current.request("status", { status: value });

  async function update() {
    const next = await revision();
    if (next === currentRevision) { observed = next; await status("current"); return; }
    if (next === failedRevision && Date.now() < retryAt) return;
    if (next !== failedRevision) failures = 0;
    await status("pending");
    // Require two stable observations so a save/build does not reload halfway.
    if (next !== observed) { observed = next; return; }
    if (!await current.request<boolean>("ready")) return;
    const candidate = spawnWorker();
    let handoff: ServerHandoff | null = null;
    let stopped = false;
    const previous = current;
    const previousRevision = currentRevision;
    try {
      await stage(candidate, next);
      if (await revision() !== next) return;
      handoff = await previous.request<ServerHandoff | null>("prepare");
      if (!handoff) return; // Busy, awaiting approval or saving: leave it alone.
      await previous.request("stop");
      stopped = true;
      currentRevision = next;
      await activate(candidate, handoff);
      current = candidate;
      failedRevision = undefined;
      failures = 0;
      await previous.dispose();
    } catch {
      currentRevision = previousRevision;
      failedRevision = next;
      retryAt = Date.now() + Math.min((options.retryMs ?? 5000) * 2 ** Math.min(failures++, 3), 30000);
      // Keep the old worker alive until replacement succeeds. If the new code
      // cannot restore sessions, its cached old code can reopen the same port.
      try { await candidate.request("stop"); } catch { /* Startup may have failed before listening. */ }
      await candidate.dispose();
      if (stopped && handoff) await activate(previous, handoff);
      else await previous.request("resume");
      await status("failed");
      console.error("SERVER_UPDATE_FAILED");
    } finally { if (candidate !== current) await candidate.dispose(); }
  }
  function check() {
    if (closed) return Promise.resolve();
    return checking ??= update().catch(() => { console.error("SERVER_UPDATE_CHECK_FAILED"); }).finally(() => { checking = undefined; });
  }
  let timer = setInterval(() => { void check(); }, options.pollMs ?? 3000);
  return {
    get descriptor() { return descriptor; }, check,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await checking;
      try {
        if (!current.exited()) {
          try { await current.request("stop"); }
          catch (error) { if (!current.exited()) throw error; }
        }
        await current.dispose();
      } catch (error) {
        closed = false;
        timer = setInterval(() => { void check(); }, options.pollMs ?? 3000);
        throw error;
      }
    },
  };
}
