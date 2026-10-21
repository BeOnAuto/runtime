import { describe, expect, it } from 'vitest';

import { droppedArgumentsIn, postedMessagesOf, withDroppedArgument } from './dropped-arguments.ts';

function posted(body: string, headers: Readonly<Record<string, string>> = {}): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

const callWithProto =
  '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"x","arguments":{"__proto__":{"admin":true}}}}';

async function droppedArgumentsOf(request: Request): Promise<readonly unknown[]> {
  return droppedArgumentsIn(await postedMessagesOf(request));
}

describe('the arguments dropped from the messages posted to an MCP endpoint', () => {
  it('finds a __proto__ argument of a tool call by its request id, and leaves the body for the SDK', async () => {
    const request = posted(callWithProto);

    expect(await droppedArgumentsOf(request)).toEqual([{ id: 7, value: { admin: true } }]);
    expect(await request.text()).toBe(callWithProto);
  });

  it('finds them in a batch, and only in tool calls that have one', async () => {
    const batch = `[${callWithProto},{"jsonrpc":"2.0","id":"b","method":"tools/call","params":{"name":"x","arguments":{"name":"n"}}},{"jsonrpc":"2.0","id":9,"method":"tools/list","params":{"__proto__":1}}]`;

    expect(await droppedArgumentsOf(posted(batch))).toEqual([{ id: 7, value: { admin: true } }]);
  });

  it.each([
    ['a body that is not JSON', posted('{"jsonrpc"')],
    ['a body over the limit', posted(callWithProto, { 'content-length': String(2 * 1024 * 1024) })],
    ['no body', new Request('http://localhost/mcp', { method: 'POST' })],
  ])('finds nothing in %s, and leaves the answer to the SDK', async (_case, request) => {
    expect(await droppedArgumentsOf(request)).toEqual([]);
  });
});

describe('withDroppedArgument', () => {
  it('gives the arguments back their __proto__ as an own field, leaving the prototype alone', () => {
    const restored = withDroppedArgument({ name: 'n' }, { id: 7, value: { admin: true } });

    expect(Object.hasOwn(restored, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
    expect(Object.entries(restored)).toEqual([
      ['name', 'n'],
      ['__proto__', { admin: true }],
    ]);
  });

  it('leaves the arguments as they are when nothing was dropped', () => {
    const input = { name: 'n' };

    expect(withDroppedArgument(input)).toBe(input);
  });
});
