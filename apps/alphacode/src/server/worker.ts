import { startServer } from "./server";
import { snapshotWeb } from "./web";
import { protocolVersion } from "./protocol";
import type { ServerHandoff, UpdateStatus } from "./handoff";

type Command = { id: number } & (
  | { method: "stage"; revision: string; directory: string }
  | { method: "start"; databasePath: string; directory: string; token?: string; port?: number; restore?: ServerHandoff }
  | { method: "status"; status: UpdateStatus }
  | { method: "ready" | "prepare" | "stop" | "resume" }
);

let server: Awaited<ReturnType<typeof startServer>> | undefined;
let web: Awaited<ReturnType<typeof snapshotWeb>> | undefined;
let status: UpdateStatus = "current";
let revision: string | undefined;
async function execute(command: Command) {
  switch (command.method) {
    case "stage":
      revision = command.revision;
      web = await snapshotWeb(command.directory, revision);
      return { protocolVersion };
    case "start":
      server = await startServer({ databasePath: command.databasePath, directory: command.directory,
        ...web, token: command.token, port: command.port, revision, restore: command.restore,
        paused: true,
        updateStatus: () => status, onUpdateRequest: () => process.send?.({ event: "retry" }),
        onIdle: () => { server = undefined; process.send?.({ event: "idle" }); },
      });
      return { origin: server.origin, token: server.token, instanceId: server.instanceId };
    case "ready": return Boolean(server?.canReload());
    case "prepare": return await server?.prepareReload() ?? null;
    case "stop": await server?.close(); server = undefined; return null;
    case "resume": server?.resume(); return null;
    case "status": status = command.status; return null;
  }
}

let work = Promise.resolve();
// The supervisor owns shutdown; a shared Windows console must not interrupt a
// worker independently of its save/close handshake.
process.on("SIGINT", () => { /* Wait for the supervisor's IPC stop command. */ });
process.on("message", (command: Command) => {
  work = work.then(async () => {
    try { process.send?.({ id: command.id, value: await execute(command) }); }
    catch { process.send?.({ id: command.id, error: "SERVER_UPDATE_FAILED" }); }
  });
});
process.on("disconnect", () => { void work.then(() => server?.close()).finally(() => process.exit()); });
process.send?.({ event: "loaded", protocolVersion });
