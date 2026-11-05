import type { AssistantMessage, ToolResultMessage } from '../contracts';

interface LoopContext {
  callModel(): Promise<AssistantMessage>;
  callTool(assistantId: string, callId: string): Promise<ToolResultMessage>;
}
/** Private kernel algorithm: every operation is awaited, every batch is serial. */
export function createLoop() {
  return {
    async execute(context: LoopContext): Promise<AssistantMessage> {
      while (true) {
        const reply = await context.callModel();
        if (reply.outcome !== 'tool_calls') return reply;
        for (const call of reply.toolCalls) await context.callTool(reply.id, call.id);
      }
    },
  };
}
