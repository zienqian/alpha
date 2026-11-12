import type { CreateProviderOptions } from "@alpha/provider";
import { createApprovals } from "./chat/approval";
import { createChat } from "./chat/controller";
import type { Chat } from "./chat/contracts";
import type { AppConfig } from "./config";
import { createRuntime } from "./runtime/create-runtime";
import type { SessionHandoff } from "./server/handoff";
import type { RuntimeTrace } from "./runtime/trace-bridge";

export async function createApplication(config: AppConfig, options: { provider?: CreateProviderOptions; restore?: SessionHandoff; trace?: RuntimeTrace } = {}): Promise<Chat> {
  const approvals = createApprovals();
  const runtime = await createRuntime(config, { approve: approvals.request, provider: options.provider,
    trace: options.trace,
    draftSessionId: options.restore && !options.restore.persisted ? options.restore.sessionId : undefined });
  return createChat(runtime, approvals, options.restore?.state);
}
