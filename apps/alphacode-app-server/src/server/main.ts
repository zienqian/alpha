import { randomUUID } from "node:crypto";
import { acquireLease, removeDescriptor } from "./lifecycle";
import { serverPaths } from "./storage";
import { serverLayout } from "./revision";
import { startSupervisor } from "./supervisor";

export async function runManagedServer(databasePath: string) {
  const paths = await serverPaths(databasePath);
  const release = await acquireLease(paths.directory, randomUUID());
  if (!release) return;
  let supervisor: Awaited<ReturnType<typeof startSupervisor>> | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    await supervisor?.close();
    try {
      if (supervisor) await removeDescriptor(paths.descriptor, supervisor.descriptor.instanceId);
    } finally { release(); }
  })().catch(error => { stopping = undefined; throw error; });
  try {
    supervisor = await startSupervisor({ databasePath: paths.database, directory: paths.directory,
      descriptorPath: paths.descriptor, layout: await serverLayout(), onIdle: () => { void stop().catch(() => { console.error("SERVER_CLOSE_FAILED"); }); },
    });
    const signal = () => { void stop().catch(() => { console.error("SERVER_CLOSE_FAILED"); }); };
    process.on("SIGTERM", signal);
    process.on("SIGINT", signal);
    return { descriptor: supervisor.descriptor, descriptorPath: paths.descriptor, close: stop };
  } catch (error) { await stop(); throw error; }
}

if (import.meta.main) {
  const databasePath = process.argv[2];
  if (!databasePath) { console.error("DATABASE_REQUIRED"); process.exitCode = 1; }
  else void runManagedServer(databasePath).catch(() => { console.error("SERVER_START_FAILED"); process.exitCode = 1; });
}
