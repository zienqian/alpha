import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "@alpha/alphacode-app-server/testing";
import type { Fetch } from "@alpha/provider";
import type { AppConfig } from "../src/config";

export interface RequestBody {
  stream?: boolean;
  model: string;
  messages: { role: string; content: string }[];
  tools: { function: { name: string } }[];
}

export function controlledStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let ended = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { ended = true; } });
  const event = (delta: object, finish_reason: string | null = null) => {
    if (!ended) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`));
  };
  return {
    response: new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    text(text: string) { event({ content: text }); },
    tool(name: string, args: object) {
      event({ tool_calls: [{ index: 0, id: "test-call", type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    },
    end(reason = "stop") {
      if (ended) return;
      event({}, reason);
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      ended = true;
      controller.close();
    },
    fail() {
      if (ended) return;
      ended = true;
      controller.error(new Error("private upstream response must not appear in the UI"));
    },
  };
}

export function textResponse(text: string): Response {
  const stream = controlledStream();
  stream.text(text);
  stream.end();
  return stream.response;
}

export function toolResponse(name: string, args: object): Response {
  const stream = controlledStream();
  stream.tool(name, args);
  stream.end("tool_calls");
  return stream.response;
}

export async function waitFor(predicate: () => boolean | Promise<boolean>, timeout = 10000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error("Condition was not reached");
    await Bun.sleep(5);
  }
}

export async function fixture(reply: (body: RequestBody, index: number) => Response,
  titleReply: (body: RequestBody, signal?: AbortSignal | null) => Response | Promise<Response> = () => Response.json({ choices: [{ message: { content: "Fixture conversation" }, finish_reason: "stop" }] })) {
  const root = await mkdtemp(join(tmpdir(), "alphacode-test-"));
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(join(workspaceRoot, "AGENTS.md"), "Project fixture instruction: use concise answers.");
  await writeFile(join(workspaceRoot, "hello.txt"), "hello-from-workspace");
  const requests: RequestBody[] = [];
  const titleRequests: RequestBody[] = [];
  const config: AppConfig = {
    configDirectory: join(root, "config"),
    skills: { sharedDirectories: false, claudeDirectories: false, trustedProjects: [], disabledNames: [] },
    workspaceRoot, databasePath: join(root, "sessions.db"),
    modelId: "test-model", baseURL: "https://offline.invalid/v1", apiKeyEnv: "UNUSED_KEY", noAuth: true,
  };
  const fetch: Fetch = async (_url, init) => {
    init?.signal?.throwIfAborted();
    const body = JSON.parse(String(init?.body)) as RequestBody;
    if (!body.stream) { titleRequests.push(body); return titleReply(body, init?.signal); }
    requests.push(body);
    return reply(body, requests.length);
  };
  try {
    const chat = await createApplication(config, { provider: { fetch } });
    return {
      chat, config, requests, titleRequests,
      async dispose() {
        await chat.close();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
