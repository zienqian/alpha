import { createProvider, defineProviderConfig } from '../src/index.js';

const config = defineProviderConfig({ providers: {
  primary: { adapter: 'openai-responses', options: { apiKey: { env: 'API_KEY' } }, models: { chat: { id: 'id', input: ['text'], reasoning: true, thinkingLevelMap: { high: 'high' } } } },
  other: { adapter: 'anthropic-messages', options: { apiKey: { env: 'API_KEY' } }, models: { reasoning: { id: 'id' } } },
} });
const provider = createProvider(config);
provider.use('primary', 'chat');
provider.use('primary', 'chat').generate({ messages: [{ role: 'developer', content: 'rules' }, { role: 'user', content: 'hi' }], thinkingLevel: 'high', headers: { 'x-request-id': 'trace' } });
// @ts-expect-error Thinking levels have a stable logical vocabulary.
provider.use('primary', 'chat').generate({ messages: [{ role: 'user', content: 'hi' }], thinkingLevel: 'extreme' });
async function consumeStream() {
  for await (const event of provider.use('primary', 'chat').stream({ messages: [{ role: 'user', content: 'hi' }] })) {
    if (event.type === 'text-delta') event.text.toUpperCase();
    if (event.type === 'tool-call') event.toolCall.name.toUpperCase();
    if (event.type === 'finish') event.result.outcome.toUpperCase();
  }
}
void consumeStream;
defineProviderConfig({ providers: { p: { adapter: 'openai-responses', options: { apiKey: { env: 'KEY' }, headers: { 'x-gateway-key': { env: 'GATEWAY_KEY' } } }, models: { main: { id: 'id' } } } } });
// @ts-expect-error Unknown provider must not typecheck.
provider.use('missing', 'chat');
// @ts-expect-error Model aliases belong to a specific provider.
provider.use('primary', 'reasoning');
defineProviderConfig({ providers: { direct: { adapter: 'anthropic-messages', options: { apiKey: { value: 'from-host-config' }, maxOutputTokens: 100 }, models: { chat: { id: 'id' } } } } });
// @ts-expect-error Anthropic requires an explicit credential.
defineProviderConfig({ providers: { invalid: { adapter: 'anthropic-messages', options: { apiKey: { none: true } }, models: { chat: { id: 'id' } } } } });
// @ts-expect-error Codex authentication requires an access token reference.
defineProviderConfig({ providers: { codex: { adapter: 'openai-codex-responses', options: { apiKey: { env: 'KEY' } }, models: { main: { id: 'id' } } } } });
// @ts-expect-error Model input modalities are constrained.
defineProviderConfig({ providers: { primary: { adapter: 'openai-responses', options: { apiKey: { env: 'KEY' } }, models: { chat: { id: 'id', input: ['smell'] } } } } });
