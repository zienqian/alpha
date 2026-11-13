import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createSqliteSessionStore } from "@alpha/adk-session/sqlite";
import type { SessionInfo } from "./protocol";
import type { AppConfig } from "../config";
import { sessionNamespace } from "../runtime/create-runtime";
import { modelContext } from "../runtime/context-usage";

export async function serverPaths(databasePath: string) {
  await mkdir(dirname(resolve(databasePath)), { recursive: true });
  const resolved = await realpath(databasePath).catch(() => realpath(dirname(resolve(databasePath))).then(parent => join(parent, basename(databasePath))));
  const database = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const directory = join(dirname(database), `.${basename(database)}.server`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return { database, directory, descriptor: join(directory, "server.json") };
}

export async function writeJson(path: string, data: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
  await rename(temporary, path);
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createRegistry(databasePath: string, directory: string) {
  const file = join(directory, "projects.json");
  const configs = new Map(Object.entries(await readJson<Record<string, AppConfig>>(file) ?? {}));
  const credentials = new Map<string, string | undefined>();
  const store = await createSqliteSessionStore({ filename: databasePath });
  let writing = Promise.resolve();
  return {
    store,
    configs,
    credentials,
    async register(input: AppConfig, credential?: string) {
      const workspaceRoot = await realpath(input.workspaceRoot);
      if (!(await stat(workspaceRoot)).isDirectory()) throw Object.assign(new Error("INVALID_DIRECTORY"), { status: 400, code: "INVALID_DIRECTORY" });
      const projectId = sessionNamespace(workspaceRoot);
      const config: AppConfig = {
        workspaceRoot, databasePath, configDirectory: input.configDirectory,
        projectName: input.projectName ?? configs.get(projectId)?.projectName,
        modelId: input.modelId, baseURL: input.baseURL, apiKeyEnv: input.apiKeyEnv, noAuth: input.noAuth,
        contextWindow: input.contextWindow,
        permissionMode: input.permissionMode, skills: input.skills,
        traceEnabled: input.traceEnabled,
        globalInstructions: input.globalInstructions, globalInstructionsPath: input.globalInstructionsPath,
      };
      configs.set(projectId, config);
      credentials.set(projectId, credential);
      writing = writing.catch(() => undefined).then(() => writeJson(file, Object.fromEntries(configs)));
      await writing;
      return projectId;
    },
    async list(): Promise<SessionInfo[]> {
      const sessions: SessionInfo[] = [];
      for (const [projectId, config] of configs) {
        let cursor: string | undefined;
        do {
          const page = await store.list(projectId, { cursor, limit: 100 });
          for (const item of page.items) sessions.push({
            id: item.id, projectId, workspaceRoot: config.workspaceRoot,
            defaultContext: modelContext(config.modelId, config.contextWindow),
            title: item.title, updatedAt: item.updatedAt, status: item.status,
          });
          cursor = page.cursor;
        } while (cursor);
      }
      return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    async find(id: string) {
      for (const [projectId, config] of configs) {
        if (await store.read({ namespace: projectId, id })) return { projectId, config };
      }
      return undefined;
    },
    async close() { await writing.catch(() => undefined); await store.close(); },
  };
}
