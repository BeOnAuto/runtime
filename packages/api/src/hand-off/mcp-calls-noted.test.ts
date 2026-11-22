import { describe, expect, it } from 'vitest';

import {
  mcpAnswerNoting,
  mcpCallsNotedIn,
  mcpRequestNoted,
  mostMcpNotes,
  notedMcpCall,
  type McpNames,
} from './mcp-calls-noted.ts';

const names: McpNames = {
  tools: new Map([
    ['list_playbooks', { operation: true, arguments: ['limit', 'cursor'] }],
    ['get_guide', { operation: false, arguments: ['name'] }],
  ]),
  guides: new Set(['start', 'reasoning']),
  prompts: new Set(['build_a_playbook']),
};

const bounds = { mostBytes: 2048, mostNamed: 2 };

const call = (params: unknown, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params });

const initialize = (clientInfo: unknown, protocolVersion: unknown = '2025-06-18') => [
  { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion, clientInfo, capabilities: {} } },
];

const notedOf = (messages: readonly unknown[]) => mcpRequestNoted(messages, 10, names, bounds);

describe('a request to an MCP endpoint, as its line names it', () => {
  it('names a call of a tool in the catalog by its operation, and its arguments the tool declares, counting the rest', () => {
    const noted = mcpRequestNoted(
      [
        call({
          name: 'list_playbooks',
          arguments: { limit: 5, cursor: 'c', password: 'hunter2', 'ada@example.com': 1 },
        }),
      ],
      120,
      names,
      bounds,
    );

    expect(noted).toEqual({
      method: 'tools/call',
      tool: 'list_playbooks',
      operation: 'list_playbooks',
      arguments: 'limit,cursor',
      undeclared: 2,
      request_bytes: 120,
    });
  });

  it('names a tool it does not serve unknown, and none of what it was given', () => {
    expect(mcpRequestNoted([call({ name: 'Ada Lovelace', arguments: { x: 1 } })], 60, names, bounds)).toEqual({
      method: 'tools/call',
      tool: 'unknown',
      undeclared: 1,
      request_bytes: 60,
    });
  });
});

describe('the guides, resources and prompts a request read, as the line names them', () => {
  it('names the guide get_guide read, the guide a resource holds and a prompt, only where the server carries them', () => {
    const asked = [
      [call({ name: 'get_guide', arguments: { name: 'start' } })],
      [call({ name: 'get_guide', arguments: { name: 'my secret notes' } })],
      [{ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'guide://reasoning' } }],
      [{ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'https://ada.example/notes?token=x' } }],
      [{ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'build_a_playbook', arguments: { a: 'b' } } }],
      [{ jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'ada@example.com' } }],
    ];

    expect(asked.map((messages: readonly unknown[]) => notedOf(messages))).toEqual([
      { method: 'tools/call', tool: 'get_guide', guide: 'start', arguments: 'name', request_bytes: 10 },
      { method: 'tools/call', tool: 'get_guide', arguments: 'name', request_bytes: 10 },
      { method: 'resources/read', resource: 'reasoning', request_bytes: 10 },
      { method: 'resources/read', request_bytes: 10 },
      { method: 'prompts/get', prompt: 'build_a_playbook', request_bytes: 10 },
      { method: 'prompts/get', request_bytes: 10 },
    ]);
  });
});

describe('an initialize, a method of its own and a batch, as the line names them', () => {
  it('names the protocol and the client of an initialize only where they are shaped as software identifiers', () => {
    expect(
      [
        initialize({ name: 'claude-code', version: '2.1.3' }),
        initialize({ name: 'Ada Lovelace', version: 'sk-live-0123456789abcdef' }),
        initialize({ name: 'ada@example.com', version: '1' }, 'anything at all'),
        initialize({ name: 'a'.repeat(32), version: '1.0' }),
        initialize('no client'),
      ].map((messages: readonly unknown[]) => notedOf(messages)),
    ).toEqual([
      {
        method: 'initialize',
        protocol: '2025-06-18',
        client: 'claude-code',
        client_version: '2.1.3',
        request_bytes: 10,
      },
      { method: 'initialize', protocol: '2025-06-18', request_bytes: 10 },
      { method: 'initialize', client_version: '1', request_bytes: 10 },
      { method: 'initialize', protocol: '2025-06-18', client_version: '1.0', request_bytes: 10 },
      { method: 'initialize', protocol: '2025-06-18', request_bytes: 10 },
    ]);
  });
});

describe('a method of its own and a batch, as the line names them', () => {
  it('names a method MCP does not define other, and a body that is no message nothing more than its bytes', () => {
    expect([
      mcpRequestNoted([{ jsonrpc: '2.0', id: 1, method: 'ada/lovelace' }], 10, names, bounds),
      mcpRequestNoted([undefined], 3, names, bounds),
      mcpRequestNoted([{ jsonrpc: '2.0', method: 'notifications/initialized' }], 10, names, bounds),
    ]).toEqual([
      { method: 'other', request_bytes: 10 },
      { request_bytes: 3 },
      { method: 'notifications/initialized', request_bytes: 10 },
    ]);
  });

  it('names a batch by its count and at most the bounded number of its methods and tools', () => {
    const batch = [
      call({ name: 'list_playbooks', arguments: {} }, 1),
      call({ name: 'nope', arguments: {} }, 2),
      call({ name: 'get_guide', arguments: {} }, 3),
      { jsonrpc: '2.0', id: 4, method: 'tools/list' },
    ];

    expect(mcpRequestNoted(batch, 400, names, bounds)).toEqual({
      method: 'batch',
      messages: 4,
      methods: 'tools/call,tools/call',
      tools: 'list_playbooks,unknown',
      request_bytes: 400,
    });
  });

  it('names a call given no arguments, and a batch of no requests, by what they hold alone', () => {
    expect([
      mcpRequestNoted([call({ name: 'list_playbooks' })], 40, names, bounds),
      mcpRequestNoted([{ jsonrpc: '2.0', id: 1, result: {} }, 'junk'], 40, names, bounds),
    ]).toEqual([
      { method: 'tools/call', tool: 'list_playbooks', operation: 'list_playbooks', request_bytes: 40 },
      { method: 'batch', messages: 2, request_bytes: 40 },
    ]);
  });
});

describe('the bounds of what a line names of a request', () => {
  it('reads no message of a body over the bound, and says it was left unread', () => {
    expect(mcpRequestNoted([call({ name: 'list_playbooks', arguments: {} })], 2049, names, bounds)).toEqual({
      unread: true,
      request_bytes: 2049,
    });
  });

  it('ships naming four messages of a batch, within the bytes of a request', () => {
    expect(mostMcpNotes).toEqual({ mostBytes: 262_144, mostNamed: 4 });
  });
});

describe('the answer of an MCP endpoint, as its line names it', () => {
  it('counts its bytes, its errors with the first code, the tool results that are errors and what a listing listed', () => {
    const noting = mcpAnswerNoting();
    noting.bytes(100);
    noting.heard({ jsonrpc: '2.0', id: 1, error: { code: -32_602, message: 'Ada Lovelace was not found' } });
    noting.heard({ jsonrpc: '2.0', id: 2, error: { code: -32_603, message: 'later' } });
    noting.heard({ jsonrpc: '2.0', id: 3, result: { isError: true, content: [{ type: 'text', text: 'secret' }] } });
    noting.heard({ jsonrpc: '2.0', id: 4, result: { tools: [{}, {}, {}] } });
    noting.heard({ jsonrpc: '2.0', id: 5, result: { prompts: [{}] } });
    noting.heard('not a message');
    noting.bytes(20);

    expect(noting.noted()).toEqual({ response_bytes: 120, errors: 2, error_code: -32_602, tool_errors: 1, listed: 4 });
  });

  it('names nothing of an answer it heard nothing of', () => {
    expect(mcpAnswerNoting().noted()).toEqual({});
  });
});

describe('the MCP calls a request made, told to whoever notes them', () => {
  it('are told, the request and its answer together, once the answer has ended', async () => {
    const told: Promise<unknown>[] = [];
    await mcpCallsNotedIn(
      () => {
        const noting = notedMcpCall({ method: 'tools/list', request_bytes: 9 });
        noting?.bytes(30);
        noting?.heard({ jsonrpc: '2.0', id: 1, result: { tools: [{}] } });
        noting?.ended();
        return Promise.resolve();
      },
      (noted) => {
        told.push(noted);
      },
    );

    expect(await Promise.all(told)).toEqual([
      { method: 'tools/list', request_bytes: 9, response_bytes: 30, listed: 1 },
    ]);
  });

  it('are noted by nothing outside a request that notes them', () => {
    expect(notedMcpCall({ request_bytes: 1 })).toBeUndefined();
  });
});
