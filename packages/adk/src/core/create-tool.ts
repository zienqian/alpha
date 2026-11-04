import type { Awaitable, Effect, Infer, InputSchema, Tool, ToolContext } from './contracts.js';
import { ensure, error } from './internal/errors.js';
import { copyObject, record, text } from './internal/json.js';

export function createTool<S extends InputSchema, C = unknown>(spec: {
  name: string;
  description: string;
  input: S;
  effect?: Effect;
  execute(input: Infer<S>, ctx: ToolContext<C>): Awaitable<string>;
}): Tool<C> {
  try {
    ensure(record(spec) && text(spec.name) && typeof spec.description === 'string' && typeof spec.execute === 'function', 'TOOL_SCHEMA_INVALID');
    const standard = spec.input?.['~standard'];
    ensure(standard?.version === 1 && typeof standard.validate === 'function' && typeof standard.jsonSchema?.input === 'function', 'TOOL_SCHEMA_INVALID');
    // Converters may attach non-enumerable Standard protocol metadata to the root.
    const schema = copyObject({ ...standard.jsonSchema.input({ target: 'draft-2020-12' }) }, 'TOOL_SCHEMA_INVALID');
    ensure(schema.type === 'object', 'TOOL_SCHEMA_INVALID');
    const effect = spec.effect ?? 'unknown';
    ensure(['read', 'write', 'unknown'].includes(effect), 'TOOL_SCHEMA_INVALID');
    const validate = standard.validate.bind(standard), execute = spec.execute;
    const info = Object.freeze({ name: spec.name, description: spec.description, inputSchema: schema, effect });
    return Object.freeze({
      info,
      async prepare(raw, signal) {
        if (signal.aborted) throw error('TOOL_INPUT_INVALID');
        try {
          const validated = await validate(copyObject(raw, 'TOOL_INPUT_INVALID'));
          ensure(record(validated) && validated.issues === undefined && Object.hasOwn(validated, 'value'), 'TOOL_INPUT_INVALID');
          const args = copyObject(validated.value, 'TOOL_INPUT_INVALID');
          return Object.freeze({
            arguments: args,
            execute: (ctx: ToolContext<C>) => execute(args as Infer<S>, ctx),
          });
        } catch { throw error('TOOL_INPUT_INVALID'); }
      },
    } satisfies Tool<C>);
  } catch { throw error('TOOL_SCHEMA_INVALID'); }
}
