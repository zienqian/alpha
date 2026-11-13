import type { AssistantMessage } from '../contracts';

interface LoopContext {
  callModel(): Promise<AssistantMessage | undefined>;
  callTools(assistantId: string): Promise<void>;
  applySteering(): boolean;
  hasSteering(): boolean;
  skipTools(assistantId: string): void;
}
/** Private kernel algorithm: each model call and complete tool batch is awaited. */
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
        await context.callTools(reply.id);
        if (context.hasSteering()) context.skipTools(reply.id);
      }
    },
  };
}
