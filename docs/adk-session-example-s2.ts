// Implemented S2 API. model and Store are application-owned dependencies.
import { createAgent } from '@alpha/adk/core';
import { createSession, createSessionPlugin } from '@alpha/adk-session';
import type { SessionStore } from '@alpha/adk-session';
import type { LanguageModel } from '@alpha/provider';

export async function createConversation(model: LanguageModel, store: SessionStore, namespace: string) {
  const session = await createSession({ store, namespace, agentKey: 'conversation@1' });
  try {
    const agent = await createAgent({
      model, instructions: '根据已有对话回答。',
      plugins: [createSessionPlugin({ session })],
    });
    // Caller owns Agent and Session: close Agent first, then Session, then its borrowed Store.
    return { agent, session };
  } catch (cause) { await session.close(); throw cause; }
}

// Usage after application setup:
// const result = await agent.prompt(input, { requestId: messageId });
// if (session.state.persistence?.status === 'pending') await session.flush();
// Retain the original result and handles if persistence remains pending; do not repeat the prompt.
