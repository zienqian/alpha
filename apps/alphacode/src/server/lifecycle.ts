import { Database } from "bun:sqlite";
import { spawn, type ChildProcess } from "node:child_process";
import { open, chmod, unlink } from "node:fs/promises";
import { join } from "node:path";
import { protocolVersion } from "./protocol";
import { createNativeClient } from "./http";
import { readJson, serverPaths } from "./storage";
import { ConfigurationError } from "../errors";

export interface ServerDescriptor {
  protocolVersion: number;
  instanceId: string;
  pid: number;
  origin: string;
  token: string;
  databasePath: string;
}

function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

export async function acquireLease(directory: string, instanceId: string) {
  const path = join(directory, "lease.sqlite");
  const database = new Database(path, { create: true });
  await chmod(path, 0o600);
  database.exec("PRAGMA busy_timeout = 10000; CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, instance TEXT NOT NULL)");
  const acquired = database.transaction(() => {
    const owner = database.query<{ pid: number }, []>("SELECT pid FROM owner WHERE id = 1").get();
    if (owner && alive(owner.pid)) return false;
    database.query("INSERT OR REPLACE INTO owner VALUES (1, ?, ?)").run(process.pid, instanceId);
    return true;
  }).immediate();
  if (!acquired) { database.close(); return undefined; }
  return () => {
    database.query("DELETE FROM owner WHERE id = 1 AND instance = ?").run(instanceId);
    database.close();
  };
}

async function discover(path: string, databasePath: string): Promise<ServerDescriptor | undefined> {
  const descriptor = await readJson<ServerDescriptor>(path);
  if (!descriptor || !alive(descriptor.pid)) return undefined;
  if (descriptor.databasePath !== databasePath || descriptor.protocolVersion !== protocolVersion || !/^http:\/\/127\.0\.0\.1:\d+$/.test(descriptor.origin)) {
    throw new ConfigurationError("An incompatible AlphaCode server is running for this database. Close its clients and restart after it exits.");
  }
  try {
    const info = await createNativeClient(descriptor).request<{ instanceId: string; protocolVersion: number }>("/api/info", undefined, AbortSignal.timeout(1500));
    if (info.instanceId !== descriptor.instanceId || info.protocolVersion !== protocolVersion) throw new Error("SERVER_IDENTITY_MISMATCH");
    return descriptor;
  } catch { return undefined; }
}

export async function ensureServer(databasePath: string) {
  const paths = await serverPaths(databasePath);
  const existing = await discover(paths.descriptor, paths.database);
  if (existing) return existing;
  const source = join(import.meta.dir, "main.ts");
  const development = await Bun.file(source).exists();
  const entry = development ? source : join(import.meta.dir, "server", "main.js");
  const config = join(import.meta.dir, development ? "../../../.." : "../../..", "bunfig.toml");
  const log = await open(join(paths.directory, "server.log"), "a", 0o600);
  let launchError: Error | undefined;
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, ["--no-env-file", `--config=${config}`, "--conditions=alpha-source", entry, paths.database], {
      detached: true, windowsHide: true, stdio: ["ignore", log.fd, log.fd],
    });
    child.once("error", error => { launchError = error; });
    child.unref();
  } finally { await log.close(); }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (launchError) throw new ConfigurationError("Could not start the local AlphaCode server.", { cause: launchError });
    const found = await discover(paths.descriptor, paths.database);
    if (found) {
      if (child.pid !== found.pid && child.exitCode === null) child.kill();
      return found;
    }
    await Bun.sleep(100);
  }
  throw new ConfigurationError(`Local server did not become ready. Inspect ${join(paths.directory, "server.log")}; an existing owner may still be starting.`);
}

export async function removeDescriptor(path: string, instanceId: string) {
  const current = await readJson<ServerDescriptor>(path);
  if (current?.instanceId === instanceId) await unlink(path);
}
