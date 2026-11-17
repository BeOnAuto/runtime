import { onTheStandingClock } from '@on.auto/definitions/testing';
import { memoryLedger } from '@on.auto/operations/testing';
import { toolBounds } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { lookupDocument } from '../testing/index.ts';
import { guideVariablesOf } from './guide-variables.ts';
import { makeLookupFunctionAdapter } from './lookup-function.ts';

function lookupSending(mostRequestBytes: number) {
  return makeLookupFunctionAdapter({
    tools: {
      listServers: () => Effect.succeed([]),
      callOnce: () => Effect.die(new Error('No call is made here')),
      mostRequestBytes,
      mostRequestBytesTo: () => mostRequestBytes,
    },
    runs: { readRecorded: () => Effect.die(new Error('No run is read here')), content: memoryLedger().service.content },
  });
}

const changedBy = {
  value: 'can be changed only by whoever runs the server',
  default: 'can be changed only by whoever runs the server',
};

describe('the values the lookup guide names', () => {
  it('are the most a call of its tool access may send, while the default stays the words the page writes', () => {
    expect([
      guideVariablesOf({ mostRequestBytes: 8 * 1_048_576 }),
      guideVariablesOf({ mostRequestBytes: toolBounds.requestBytes }),
      guideVariablesOf(),
    ]).toEqual([
      { 'lookup.most_call_arguments': { value: '8 MiB', default: '16 MiB' }, 'lookup.bounds_changed_by': changedBy },
      { 'lookup.most_call_arguments': { value: '16 MiB', default: '16 MiB' }, 'lookup.bounds_changed_by': changedBy },
      { 'lookup.most_call_arguments': { value: '16 MiB', default: '16 MiB' }, 'lookup.bounds_changed_by': changedBy },
    ]);
  });

  it('give the bound in the words a save past it is refused with', () => {
    const lookup = lookupSending(64);
    const named = lookup.guide.variables?.['lookup.most_call_arguments']?.value;
    const refused = Effect.runSync(
      Effect.flip(
        onTheStandingClock(lookup.prepare(lookupDocument({ with: [`    note: ${'x'.repeat(100)}`], input: [] }))),
      ),
    );

    expect([named, JSON.stringify(refused)]).toEqual([
      '64 bytes',
      expect.stringContaining(`more than the ${String(named)} a call may send to a tool server`),
    ]);
  });
});
