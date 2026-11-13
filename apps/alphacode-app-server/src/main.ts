#!/usr/bin/env bun
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readGlobalConfig } from "./global-config";
import { errorCode } from "./errors";

const usage = "Usage: alphacode-app-server [--ensure] [--database <path>]\nStarts the shared local HTTP/SSE service. --ensure discovers or starts a shared service and exits. No terminal UI or model request is started.\nDefaults: ALPHACODE_DB, then config.yaml databasePath, then ~/.alphacode/sessions.db.\nThe ready event reports the private descriptor path; credentials are never printed.";
const expand = (path: string) => path === "~" ? homedir() : /^~[/\\]/.test(path) ? join(homedir(), path.slice(2)) : path;

try {
  const args = process.argv.slice(2);
  const ensure = args[0] === "--ensure";
  if (ensure) args.shift();
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) console.log(usage);
  else {
    if (args.length && (args.length !== 2 || args[0] !== "--database" || !args[1]?.trim() || args[1].startsWith("--"))) {
      throw Object.assign(new Error(usage), { code: "CLI_USAGE" });
    }
    const explicit = args[1] ?? process.env.ALPHACODE_DB;
    let databasePath: string;
    if (explicit !== undefined) databasePath = resolve(expand(explicit));
    else {
      const directory = resolve(expand(process.env.ALPHACODE_HOME?.trim() || join(homedir(), ".alphacode")));
      const { defaults } = await readGlobalConfig(directory);
      databasePath = resolve(directory, expand(defaults.databasePath ?? "sessions.db"));
    }
    const server = ensure ? await (async () => {
      const [{ ensureServer }, { serverPaths }] = await Promise.all([import("./server/lifecycle"), import("./server/storage")]);
      const descriptor = await ensureServer(databasePath);
      return { descriptor, descriptorPath: (await serverPaths(databasePath)).descriptor };
    })() : await (await import("./server/main")).runManagedServer(databasePath);
    if (!server) throw Object.assign(new Error("A server already owns this database."), { code: "SERVER_ALREADY_RUNNING" });
    console.log(JSON.stringify({ event: "ready", protocolVersion: server.descriptor.protocolVersion,
      origin: server.descriptor.origin, pid: server.descriptor.pid, descriptorPath: server.descriptorPath }));
  }
} catch (error) {
  const code = errorCode(error);
  console.error(code === "CLI_USAGE" ? usage : code === "UNEXPECTED_ERROR" ? "SERVER_START_FAILED" : code);
  process.exitCode = 1;
}
