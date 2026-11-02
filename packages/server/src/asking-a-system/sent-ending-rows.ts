import { expect } from 'vitest';

import {
  failedAfterCalling,
  mayChange,
  mayHaveActed,
  notAnsweredInTime,
  quickCalls,
  refusingTheArguments,
  unknown,
  unworkable,
  type Rows,
} from '../testing/interaction-servers/call-endings.ts';
import { calling } from '../testing/interaction-servers/system-calls.ts';

export const afterSending: Rows = [
  [
    'arguments the tool refused',
    { server: { hints: { strict: mayChange } }, document: calling('strict', ["    limit: '15'"]) },
    unworkable(refusingTheArguments),
  ],
  [
    'an error of the tool',
    { server: { hints: { denied: mayChange } }, document: calling('denied') },
    unknown('tool_error', expect.stringMatching(/^The denied tool of chat answered an error: /u)),
  ],
  [
    'a failure of the server',
    { server: { hints: { broken: mayChange } }, document: calling('broken') },
    unknown('server_failed', failedAfterCalling('broken')),
  ],
  [
    'a call that took longer than a call may',
    { server: { hints: { sleep: mayChange }, timing: quickCalls }, document: calling('sleep', ['    ms: 5000']) },
    unknown('server_failed', notAnsweredInTime),
  ],
];

export const unreadable: Rows = [
  [
    'an answer with no document',
    { server: { hints: { photo: mayChange } }, document: calling('photo') },
    unworkable(
      `The photo tool of chat answered neither structured content nor text, so there is nothing to read${mayHaveActed}`,
    ),
  ],
  [
    'an answer with nothing at read',
    { document: { read: '/nothing' } },
    unworkable(`The answer of the thread tool of chat holds nothing at /nothing${mayHaveActed}`),
  ],
  [
    'an answer nested past 512 levels',
    {
      document: calling('echo', ["    deep: { inner: '{{ input.deep }}' }"]),
      input: { deep: Array.from({ length: 511 }).reduce<unknown>((inner) => ({ n: inner }), 'leaf') },
    },
    unworkable(`What the echo tool of chat answered nests deeper than the 512 levels a value may${mayHaveActed}`),
  ],
  [
    'an answer the output schema refuses',
    { document: { output: ['output:', '  schema: { type: string }'] } },
    unworkable(
      expect.stringMatching(/^What the thread tool of chat answered at \/messages does not match the output schema: /u),
    ),
  ],
];
