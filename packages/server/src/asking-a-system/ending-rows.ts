import { expect } from 'vitest';

import {
  mayChange,
  problems,
  quickOpening,
  sentNothing,
  someDetail,
  unworkable,
  type Row,
  type Rows,
} from '../testing/interaction-servers/call-endings.ts';
import { calling, openInput } from '../testing/interaction-servers/system-calls.ts';

export function acting(row: Row, ...tools: readonly string[]): Row {
  const hints = Object.fromEntries(['thread', ...tools].map((tool) => [tool, mayChange]));
  return { ...row, server: { ...row.server, hints: { ...hints, ...row.server?.hints } } };
}

export const beforeAnything: Rows = [
  [
    'an input that does not match',
    { input: { channel: 7 } },
    { status: 422, type: `${problems}invalid_input`, kind: 'input_schema', detail: someDetail, retryAfter: null },
  ],
  [
    'an argument that reads what the input lacks',
    { document: { input: openInput }, input: { channel: 'C0123' } },
    {
      status: 422,
      type: `${problems}invalid_input`,
      detail: 'The definition reads input.thread on line 1, which the input does not have',
      retryAfter: null,
    },
  ],
  [
    'a render a filter stopped',
    { document: { with: ["    channel: '{{ input.channel | divided_by: 0 }}'"] } },
    {
      status: 422,
      type: `${problems}invalid_input`,
      detail: 'The argument channel of the call cannot be rendered with this input',
      retryAfter: null,
    },
  ],
  [
    'an argument that renders a structure among text',
    { document: { with: ["    channel: 'In {{ input.channel }}'"], input: openInput }, input: { channel: ['C0123'] } },
    unworkable(
      'The argument channel of the call renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is',
    ),
  ],
  [
    'arguments past 256 KiB',
    {
      document: { with: ["    a: '{{ input.a }}'", "    b: '{{ input.a }}'"], input: openInput },
      input: { a: 'x'.repeat(131_100) },
    },
    unworkable(
      'The arguments of the call take 262215 bytes, more than the 262144 a call may send; give the function a smaller input',
    ),
  ],
  [
    'a server that does not serve the playbook',
    { server: { entry: { playbooks: ['beta'] } } },
    sentNothing('tool_server_not_configured', 'No tool server named chat is configured for this playbook'),
  ],
  [
    'a tool the operator does not allow',
    { server: { entry: { allowed: ['search'] } } },
    sentNothing('tool_not_allowed', 'The operator of this server does not allow chat/thread'),
  ],
  [
    'a server that cannot be reached',
    { before: (server) => server.fake.close() },
    sentNothing('unreachable', expect.stringContaining('could not be reached'), 'tool_server_failed'),
  ],
  [
    'a server that refuses the key at its opening',
    {
      server: {
        entry: { headers: { Authorization: 'Bearer ${STALE_CHAT_KEY}' } },
        environment: { STALE_CHAT_KEY: 'chat-api-key-retired' },
      },
    },
    sentNothing(
      'key_refused',
      'The tool server chat could not be used: The tool server answered HTTP 401',
      'tool_server_failed',
    ),
  ],
  [
    'a listing of the tools the server limits',
    {
      before: (server) => {
        server.fake.answerNextOf('tools/list', 429, 1, { 'retry-after': '120' });
      },
    },
    sentNothing('rate_limited', expect.stringContaining('could not be used'), 'tool_server_failed'),
  ],
  [
    'a listing of the tools that fails',
    {
      before: (server) => {
        server.fake.answerNextOf('tools/list', 500);
      },
    },
    sentNothing('failing', expect.stringContaining('answered HTTP 500'), 'tool_server_failed'),
  ],
  [
    'a listing of the tools that does not answer in time',
    {
      server: { timing: quickOpening },
      before: (server) => {
        server.fake.holdNextOf('tools/list');
      },
    },
    sentNothing(
      'unreachable',
      'The tool server chat could not be used: The tool server did not answer in time',
      'tool_server_failed',
    ),
  ],
  [
    'a tool the server does not list',
    { document: calling('gone') },
    sentNothing('tool_not_listed', 'The tool server chat does not list the tool gone'),
  ],
];
