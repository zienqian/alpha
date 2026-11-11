import type { AssistantMessage, ToolResultMessage } from '../contracts';

interface LoopContext {
  callModel(): Promise<AssistantMessage | undefined>;
  callTool(assistantId: string, callId: string): Promise<ToolResultMessage>;
  applySteering(): boolean;
  hasSteering(): boolean;
  skipTools(assistantId: string): void;
}
/** Private kernel algorithm: every operation is awaited, every batch is serial. */
export function createLoop() {
  return {
    async execute(context: LoopContext): Promise<AssistantMessage> {
      while (true) {
        context.applySteering();
        const reply = await context.callModel();
        if (!reply) continue;
        if (reply.outcome !== 'tool_calls') {
          if (context.applySteering()) continue;
          return reply;
        }
        for (const call of reply.toolCalls) {
          if (context.hasSteering()) { context.skipTools(reply.id); break; }
          await context.callTool(reply.id, call.id);
        }
      }
    },
  };
}
