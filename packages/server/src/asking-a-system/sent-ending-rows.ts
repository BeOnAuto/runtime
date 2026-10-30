import { expect } from 'vitest';

import { calling } from '../testing/interaction-servers/system-calls.ts';
import {
  failedAfterCalling,
  mayChange,
  mayHaveActed,
  notAnsweredInTime,
  quickCalls,
  refusingTheArguments,
  unfinished,
  unknown,
  unworkable,
  type Ending,
  type Row,
} from './ending-rows.ts';

export const afterSending: ReadonlyArray<readonly [string, Row, Ending]> = [
  [
    'arguments a read-only tool refused',
    { document: calling('strict', ["    limit: '15'"]) },
    unworkable(refusingTheArguments),
  ],
  [
    'arguments any other tool refused',
    { server: { hints: { strict: mayChange } }, document: calling('strict', ["    limit: '15'"]) },
    unworkable(refusingTheArguments),
  ],
  [
    'an error of a read-only tool',
    { document: calling('denied') },
    unfinished('tool_error', expect.stringMatching(/^The denied tool of chat answered an error: /u)),
  ],
  [
    'a failure of the server on a read-only tool',
    { document: calling('broken') },
    unfinished('server_failed', failedAfterCalling('broken')),
  ],
  [
    'a read-only tool that took longer than a call may',
    { server: { timing: quickCalls }, document: calling('sleep', ['    ms: 5000']) },
    unfinished('server_failed', notAnsweredInTime),
  ],
  [
    'an error of any other tool',
    { server: { hints: { denied: mayChange } }, document: calling('denied') },
    unknown('tool_error', expect.stringMatching(/^The denied tool of chat answered an error: /u)),
  ],
  [
    'a failure of the server on any other tool',
    { server: { hints: { broken: mayChange } }, document: calling('broken') },
    unknown('server_failed', failedAfterCalling('broken')),
  ],
  [
    'any other tool that took longer than a call may',
    { server: { hints: { sleep: mayChange }, timing: quickCalls }, document: calling('sleep', ['    ms: 5000']) },
    unknown('server_failed', notAnsweredInTime),
  ],
];

export const unreadable: ReadonlyArray<readonly [string, Row, Ending]> = [
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
    'an answer nested past 512 levels, of a tool that may change something',
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
