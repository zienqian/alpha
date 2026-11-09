import { randomUUID } from "node:crypto";
import { protocolVersion } from "./protocol";
import { acquireLease, removeDescriptor } from "./lifecycle";
import { serverPaths, writeJson } from "./storage";
import { startServer } from "./server";
import { enableWeb } from "./web";

async function main() {
  const databasePath = process.argv[2];
  if (!databasePath) throw new Error("DATABASE_REQUIRED");
  const paths = await serverPaths(databasePath);
  const instanceId = randomUUID();
  const release = await acquireLease(paths.directory, instanceId);
  if (!release) return;
  let released = false;
  const cleanup = async () => {
    if (released) return;
    released = true;
    try { await removeDescriptor(paths.descriptor, instanceId); } finally { release(); }
  };
  try {
    const server = await startServer({ databasePath: paths.database, directory: paths.directory, instanceId, enableWeb,
      onIdle: () => { void cleanup(); },
    });
    const stop = () => { void server.close().then(cleanup).catch(() => { console.error("SERVER_CLOSE_FAILED"); }); };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    try {
      await writeJson(paths.descriptor, {
        protocolVersion, instanceId, pid: process.pid, origin: server.origin, token: server.token, databasePath: paths.database,
      });
    } catch (error) { await server.close(); throw error; }
  } catch (error) { await cleanup(); throw error; }
}

void main().catch(() => { console.error("SERVER_START_FAILED"); process.exitCode = 1; });
