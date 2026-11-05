import type { CreateProviderOptions } from "@alpha/provider";
import { createApprovals } from "./chat/approval";
import { createChat } from "./chat/controller";
import type { Chat } from "./chat/contracts";
import type { AppConfig } from "./config";
import { createRuntime } from "./runtime/create-runtime";

export async function createApplication(config: AppConfig, options: { provider?: CreateProviderOptions } = {}): Promise<Chat> {
  const approvals = createApprovals();
  const runtime = await createRuntime(config, { approve: approvals.request, provider: options.provider });
  return createChat(runtime, approvals);
}
