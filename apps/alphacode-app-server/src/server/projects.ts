import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { AppConfig } from "../config";
import { readGlobalConfig } from "../global-config";
import { modelContext } from "../runtime/context-usage";
import { sessionNamespace } from "../runtime/create-runtime";
import type { createRegistry } from "./storage";
import { fail, jsonBody, requiredString } from "./security";

// Public project records never expose provider configuration or credentials.
function projectInfo(projectId: string, config: AppConfig) {
  return { projectId, workspaceRoot: config.workspaceRoot,
    name: config.projectName || basename(config.workspaceRoot) || config.workspaceRoot,
    defaultContext: modelContext(config.modelId, config.contextWindow) };
}

async function defaultConfig(workspaceRoot: string, databasePath: string): Promise<AppConfig> {
  const configDirectory = resolve(process.env.ALPHACODE_HOME?.trim() || join(homedir(), ".alphacode"));
  const { defaults, instructions, instructionsPath } = await readGlobalConfig(configDirectory);
  const modelId = process.env.ADK_MODEL?.trim() || defaults.modelId;
  if (!modelId) return fail(409, "MODEL_REQUIRED");
  const auth = process.env.ADK_AUTH;
  if (auth && auth !== "none" && auth !== "api_key") return fail(400, "INVALID_AUTH");
  return { workspaceRoot, databasePath, configDirectory, modelId,
    contextWindow: modelId === defaults.modelId ? defaults.contextWindow : undefined,
    maxOutputTokens: modelId === defaults.modelId ? defaults.maxOutputTokens : undefined,
    autoCompact: defaults.autoCompact,
    baseURL: process.env.ADK_BASE_URL ?? defaults.baseURL ?? "https://api.openai.com/v1",
    apiKeyEnv: process.env.ADK_API_KEY_ENV ?? defaults.apiKeyEnv ?? "OPENAI_API_KEY",
    noAuth: auth ? auth === "none" : process.env.ADK_API_KEY_ENV !== undefined ? false : defaults.noAuth ?? false,
    permissionMode: "ask", skills: defaults.skills, traceEnabled: process.env.ALPHACODE_TRACE !== "0",
    globalInstructions: instructions, globalInstructionsPath: instructionsPath };
}

export function createProjectRoutes(registry: Awaited<ReturnType<typeof createRegistry>>, databasePath: string, changed: () => void) {
  return async (request: Request) => {
    if (request.method === "GET") return Response.json({ projects: [...registry.configs].map(([id, config]) => projectInfo(id, config)) });
    if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
    const body = await jsonBody(request);
    const name = requiredString(body, "name", 100).trim();
    const path = requiredString(body, "workspaceRoot", 4096).trim();
    if (!isAbsolute(path) || path.includes("\0")) return fail(400, "INVALID_DIRECTORY");
    const workspaceRoot = await realpath(path).catch(() => fail(400, "DIRECTORY_UNAVAILABLE"));
    if (!(await stat(workspaceRoot).catch(() => fail(400, "DIRECTORY_UNAVAILABLE"))).isDirectory()) return fail(400, "INVALID_DIRECTORY");
    const id = sessionNamespace(workspaceRoot);
    const existing = registry.configs.get(id);
    if (existing) return Response.json({ project: projectInfo(id, existing) });
    const sourceId = body.sourceProjectId === undefined ? [...registry.configs.keys()].at(-1) : requiredString(body, "sourceProjectId", 100);
    const source = sourceId ? registry.configs.get(sourceId) : undefined;
    if (sourceId && !source) return fail(404, "PROJECT_NOT_FOUND");
    const config = source ?? await defaultConfig(workspaceRoot, databasePath);
    const registered = { ...config, workspaceRoot, projectName: name, permissionMode: "ask" as const };
    const projectId = await registry.register(registered, sourceId ? registry.credentials.get(sourceId) : undefined);
    changed();
    return Response.json({ project: projectInfo(projectId, registered) }, { status: 201 });
  };
}
