import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import type { AppConfig } from "../config";
import { defaultWorkspacePath, globalConfigDirectory, readGlobalConfig, readGlobalDefaults } from "../global-config";
import { modelContext } from "../runtime/context-usage";
import { sessionNamespace } from "../runtime/create-runtime";
import type { createRegistry } from "./storage";
import { fail, jsonBody, requiredString } from "./security";

// Public project records never expose provider configuration or credentials.
function projectInfo(projectId: string, config: AppConfig, defaultProjectId?: string) {
  return { projectId, workspaceRoot: config.workspaceRoot,
    ...(projectId === defaultProjectId ? { isDefaultWorkspace: true } : {}),
    name: config.projectName || basename(config.workspaceRoot) || config.workspaceRoot,
    defaultContext: modelContext(config.modelId, config.contextWindow) };
}

async function defaultConfig(workspaceRoot: string, databasePath: string): Promise<AppConfig> {
  const configDirectory = globalConfigDirectory();
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

export async function ensureDefaultProject(registry: Awaited<ReturnType<typeof createRegistry>>, databasePath: string) {
  const directory = globalConfigDirectory();
  const { defaults } = await readGlobalConfig(directory);
  const path = defaultWorkspacePath(directory, defaults);
  await mkdir(path, { recursive: true }).catch(() => fail(400, "DIRECTORY_UNAVAILABLE"));
  const workspaceRoot = await realpath(path).catch(() => fail(400, "DIRECTORY_UNAVAILABLE"));
  const id = sessionNamespace(workspaceRoot);
  if (registry.configs.has(id)) return id;
  const sourceId = [...registry.configs.keys()].at(-1);
  const source = sourceId ? registry.configs.get(sourceId) : undefined;
  const config = source ?? await defaultConfig(workspaceRoot, databasePath);
  return registry.register({ ...config, workspaceRoot, projectName: undefined, permissionMode: "ask" },
    sourceId ? registry.credentials.get(sourceId) : undefined);
}

export function createProjectRoutes(registry: Awaited<ReturnType<typeof createRegistry>>, databasePath: string, changed: () => void) {
  return async (request: Request) => {
    if (request.method === "GET") {
      const directory = globalConfigDirectory();
      const path = defaultWorkspacePath(directory, await readGlobalDefaults(directory));
      const defaultProjectId = sessionNamespace(await realpath(path).catch(() => path));
      return Response.json({ projects: [...registry.configs].map(([id, config]) => projectInfo(id, config, defaultProjectId)) });
    }
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
