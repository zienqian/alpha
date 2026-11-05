import { mkdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { Agent } from "@alpha/adk/core";
import { createSession, createSessionPlugin, type Session, type SessionStore } from "@alpha/adk-session";
import { createSqliteSessionStore } from "@alpha/adk-session/sqlite";
import { createCodingAgent, type CodingApproval } from "@alpha/coding-agent";
import { createProvider, type CreateProviderOptions } from "@alpha/provider";
import type { AppConfig } from "./config.js";

export interface Runtime {
  agent: Agent;
  session: Session;
  readonly cwd: string;
  close(): Promise<void>;
}

export async function createRuntime(config: AppConfig, options: {
  approve?: CodingApproval;
  provider?: CreateProviderOptions;
} = {}): Promise<Runtime> {
  const model = createProvider({ providers: { main: {
    adapter: "openai-completions",
    options: {
      baseURL: config.baseURL,
      apiKey: config.noAuth ? { none: true } : { env: config.apiKeyEnv },
    },
    models: { chat: { id: config.modelId } },
  } } }, options.provider).use("main", "chat");

  const cwd = await realpath(config.workspaceRoot);
  let store: SessionStore | undefined;
  let session: Session | undefined;
  let agent: Agent | undefined;
  try {
    await mkdir(dirname(config.databasePath), { recursive: true });
    store = await createSqliteSessionStore({ filename: config.databasePath });
    session = await createSession({
      store,
      namespace: sessionNamespace(cwd),
      agentKey: `alphacode-v1:${config.modelId}`,
      title: "AlphaCode",
    });
    agent = await createCodingAgent({
      model, cwd, approve: options.approve,
      instructions: "You are AlphaCode. Respond in the user's language. Use Markdown for explanations and fenced blocks for code. Keep answers concise.",
      plugins: [createSessionPlugin({ session })],
    });
  } catch (error) {
    // Startup has not accepted a prompt; release only resources created here.
    for (const resource of [agent, session, store]) {
      try { await resource?.close(); } catch { /* Keep the original initialization error. */ }
    }
    throw error;
  }

  const activeAgent = agent, activeSession = session, activeStore = store;
  let closing: Promise<void> | undefined;
  return {
    agent, session, cwd,
    close() {
      if (!closing) closing = (async () => {
        try {
          await activeAgent.close();
        } catch (error) {
          // The Session plugin unbinds even if its final save failed. Retry the
          // captured commit only; never rerun the model or tools on shutdown.
          if (activeSession.state.persistence?.status !== "pending") throw error;
          const saved = await activeSession.flush();
          if (saved.status === "pending") throw Object.assign(new Error(), { code: saved.code });
        }
        await activeSession.close();
        await activeStore.close();
      })().catch(error => {
        closing = undefined;
        throw error;
      });
      return closing;
    },
  };
}

// Preserve the existing local:<sha256> namespace so saved Windows sessions remain visible.
export function sessionNamespace(cwd: string, platform = process.platform): string {
  return `local:${createHash("sha256").update(platform === "win32" ? cwd.toLowerCase() : cwd).digest("hex")}`;
}
