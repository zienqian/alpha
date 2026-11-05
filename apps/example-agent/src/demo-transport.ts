import type { Fetch } from '@alpha/provider';

/** Offline HTTP fixture: exercises the real Provider parser without network access. */
export function createDemoFetch(): Fetch {
  let calls = 0;
  return async (_input, init) => {
    init?.signal?.throwIfAborted();
    calls++;
    const events = calls === 1
      ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'demo-call', type: 'function', function: { name: 'get_order', arguments: '{"id":"A123"}' } }] }, finish_reason: 'tool_calls' }] }]
      : [{ choices: [{ delta: { content: '订单 A123 已发货（离线演示数据）。' }, finish_reason: 'stop' }] }];
    const wire = events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n';
    return new Response(wire, { headers: { 'content-type': 'text/event-stream' } });
  };
}
