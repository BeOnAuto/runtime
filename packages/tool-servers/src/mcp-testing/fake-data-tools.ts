import { ProtocolError, ProtocolErrorCode, type CallToolResult } from '@modelcontextprotocol/server';

import type { FakeTool } from './fake-tools.ts';

export const threadReplies = [
  { user: 'member-17', text: 'Shipped the fix to staging.', ts: '1728380000.000100' },
  { user: 'member-42', text: 'Thanks, closing the ticket.', ts: '1728380100.000200' },
];

const firstPage = { items: [1, 2], next: 'p2' };

const lastPage = { items: [3], next: null };

export const brokenPromise = { count: 'many' };

function argument(input: unknown, name: string): unknown {
  return Reflect.get(new Object(input), name);
}

function texts(...lines: readonly string[]): CallToolResult {
  return { content: lines.map((line) => ({ type: 'text', text: line })) };
}

export const dataTools: readonly FakeTool[] = [
  {
    name: 'thread',
    description: 'Lists the replies of a thread, oldest first, and says how many there are.',
    inputSchema: {
      type: 'object',
      properties: { thread: { type: 'string' }, limit: { type: 'number' } },
      required: [],
    },
    annotations: { readOnlyHint: true },
    answer: () => ({
      ...texts('2 replies in the thread.'),
      structuredContent: { ok: true, messages: threadReplies, has_more: false },
    }),
  },
  {
    name: 'pages',
    description: 'Lists one page of items and the cursor of the next page, null after the last.',
    inputSchema: { type: 'object', properties: { cursor: { type: 'string' } }, required: [] },
    annotations: { readOnlyHint: true },
    answer: (input) => {
      const page = argument(input, 'cursor') === firstPage.next ? lastPage : firstPage;
      return { ...texts(`${page.items.length} items.`), structuredContent: page };
    },
  },
  {
    name: 'blocks',
    description: 'Answers in two text blocks.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true },
    answer: () => texts('{"page":1}', '{"page":2}'),
  },
  {
    name: 'promised',
    description: 'Declares an output schema of a count, and answers a count that is not a number.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] },
    annotations: { readOnlyHint: true },
    answer: () => ({ ...texts(JSON.stringify(brokenPromise)), structuredContent: brokenPromise }),
  },
  {
    name: 'strict',
    description: 'Counts to the limit it is given, a whole number, and refuses any other.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, required: ['limit'] },
    annotations: { readOnlyHint: true },
    answer: (input) => {
      const limit = argument(input, 'limit');
      if (!Number.isInteger(limit)) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'limit must be a whole number');
      }
      return texts(JSON.stringify({ limit }));
    },
  },
];
