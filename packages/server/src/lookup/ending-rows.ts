import { expect } from 'vitest';

import {
  failedAfterCalling,
  mayChange,
  notAnsweredInTime,
  problems,
  quickCalls,
  quickOpening,
  reads,
  refusingTheArguments,
  sentNothing,
  someDetail,
  unfinished,
  unworkable,
  type Rows,
} from '../testing/interaction-servers/call-endings.ts';
import { calling, openInput } from '../testing/interaction-servers/system-calls.ts';

export const beforeSending: Rows = [
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
    'arguments past 16 KiB',
    {
      document: { with: ["    a: '{{ input.a }}'", "    b: '{{ input.b }}'"], input: openInput },
      input: { a: 'x'.repeat(8200), b: 'x'.repeat(8200) },
    },
    unworkable('The arguments of the call take 16415 bytes, more than the 16384 a call may send'),
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
    'a tool its server has marked acts since the function was saved',
    {
      before: (server) => {
        server.fake.annotateTool('thread', mayChange);
      },
    },
    {
      status: 503,
      type: `${problems}unavailable`,
      kind: 'tool_not_read_only',
      detail: 'The thread tool of chat is marked acts, and the call needs one marked reads, so it was not sent',
      retryAfter: null,
    },
  ],
];

export const afterSending: Rows = [
  [
    'arguments the tool refused',
    { document: calling('strict', ["    limit: '15'"]) },
    unworkable(refusingTheArguments),
  ],
  [
    'an error of the tool',
    { document: calling('denied') },
    unfinished('tool_error', expect.stringMatching(/^The denied tool of chat answered an error: /u)),
  ],
  [
    'a failure of the server',
    { document: calling('broken') },
    unfinished('server_failed', failedAfterCalling('broken')),
  ],
  [
    'a call that took longer than a call may',
    { server: { timing: quickCalls }, document: calling('sleep', ['    ms: 5000']) },
    unfinished('server_failed', notAnsweredInTime),
  ],
];

export const unreadable: Rows = [
  [
    'an answer with no document',
    { document: calling('photo') },
    unworkable('The photo tool of chat answered neither structured content nor text, so there is nothing to read'),
  ],
  [
    'an answer with nothing at read',
    { document: { read: '/nothing' } },
    unworkable('The answer of the thread tool of chat holds nothing at /nothing'),
  ],
  [
    'an answer in text that is not JSON',
    { document: { ...calling('search', ['    query: acme']), read: '/rows' } },
    unworkable('The search tool of chat answered text that is not JSON, which holds nothing at /rows'),
  ],
  [
    'an answer past what a run may record',
    { document: calling('large', ['    kib: 1030']) },
    unworkable(
      expect.stringMatching(
        /^What the large tool of chat answered takes \d+ bytes as JSON with the record of the run, more than the 1048576 a run may record$/u,
      ),
    ),
  ],
  [
    'an answer nested past 512 levels',
    {
      server: { hints: { echo: reads } },
      document: calling('echo', ["    deep: { inner: '{{ input.deep }}' }"]),
      input: { deep: Array.from({ length: 511 }).reduce<unknown>((inner) => ({ n: inner }), 'leaf') },
    },
    unworkable('What the echo tool of chat answered nests deeper than the 512 levels a value may'),
  ],
  [
    'an answer the output schema refuses',
    { document: { output: ['output:', '  schema: { type: string }'] } },
    unworkable(
      expect.stringMatching(/^What the thread tool of chat answered at \/messages does not match the output schema: /u),
    ),
  ],
];
