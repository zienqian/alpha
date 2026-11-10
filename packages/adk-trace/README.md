# @alpha/adk-trace

Independent, fail-open execution tracing for ADK. The plugin observes public events;
it does not own the run boundary, store message bodies, or depend on Session.

```ts
import { createAgent } from '@alpha/adk/core';
import { createTracePlugin, createTraceService } from '@alpha/adk-trace';
import { createSqliteTraceStore } from '@alpha/adk-trace/sqlite';

const store = await createSqliteTraceStore({ filename: '/absolute/path/traces.db' });
const service = createTraceService({ store });
const scope = { namespace: 'project', sessionId: 'conversation' };
const agent = await createAgent({
  instructions: 'Be helpful.',
  model, // Any ADK LanguageModel supplied by the application.
  plugins: [createTracePlugin({ service, scope })],
});
try {
  await agent.prompt('Inspect the project');
  const { items } = await service.list(scope);
  if (items[0]) console.log(await service.get(scope, items[0].traceId));
} finally {
  await agent.close();
  await service.close(); // The application, not an individual plugin, owns this.
}
```

Omit `store` for the bounded in-memory implementation. SQLite requires Bun and uses
a separate Worker; importing the package root does not load SQLite. Browser code
may import **types only** from `@alpha/adk-trace/contracts`.

The default queue holds at most 4,096 events / 8 MiB of estimated UTF-16 metadata;
there are at most 128 live traces and 10,000 spans per trace. Capacity loss is
reported as partial capture. A single event retains at most 512 tool references.
Delta bodies are replaced by a nonempty marker before enqueueing. The SQLite store
retains completed records for seven days with a 1 GiB logical snapshot budget;
active records are not evicted. SQLite files and WAL can exceed the logical budget.

Snapshots are batched every 250 ms. Store failures keep execution independent and
expose degraded health. Graceful close flushes with a bounded deadline; abrupt
termination may lose the unflushed tail. Persisted unfinished runs become
`unknown / interrupted` on reopening. Two live owners of one database are rejected.

Trace IDs are opaque. Every read/list/delete takes the same namespace/session scope.
Scope validation is an ownership boundary supplied by the host, not authentication.
See [implementation notes](../../docs/trace-implementation.md) for the AlphaCode API,
UI source provenance, persistence decisions, and verification.
