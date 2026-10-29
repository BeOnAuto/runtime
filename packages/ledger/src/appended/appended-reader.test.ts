import { cursorOfParts } from '@on.auto/operations';
import { Clock, Effect, Exit, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import type { AppendedFactsAsked } from '../event-store.ts';
import { appendedFactsReaderOf } from './appended-reader.ts';

const alpha = { kind: 'playbook', playbook: { org: 'acme', playbook: 'alpha' } } as const;

function aStoreAsked() {
  const asked: AppendedFactsAsked[] = [];
  const reader = appendedFactsReaderOf({
    pointLength: 1,
    readAppendedFacts: (_scope, request) => {
      asked.push(request);
      return Promise.resolve({ held: true, facts: [], last: null, through: ['7'], more: false });
    },
    waitForAppend: () => Promise.resolve('ended'),
    endWaits: Function.constVoid,
  });
  return { asked, reader };
}

function refused(after: string): Promise<boolean> {
  const { reader } = aStoreAsked();
  return Effect.runPromise(Effect.isFailure(reader.readAppendedFacts(alpha, { after, most: 1, dataOf: [] })));
}

describe('the cursor of the facts appended to a scope', () => {
  it('is refused without a read when it is not a point and the id of a fact, or the start', async () => {
    const { asked, reader } = aStoreAsked();

    const fromTheStart = await Effect.runPromise(
      reader.readAppendedFacts(alpha, { after: cursorOfParts([]), most: 1, dataOf: [] }),
    );
    const refusals = await Promise.all([
      refused('not a cursor'),
      refused(cursorOfParts(['x', 'message'])),
      refused(cursorOfParts(['21', 3])),
      refused(cursorOfParts(['21', 'message', 'beyond'])),
      refused(cursorOfParts(['21'])),
    ]);

    expect(asked).toEqual([{ after: null, most: 1, dataOf: [] }]);
    expect([fromTheStart.cursor, fromTheStart.through]).toEqual([cursorOfParts([]), cursorOfParts(['7'])]);
    expect(refusals).toEqual([true, true, true, true, true]);
  });

  it('is waited after only when it is a point the ledger was read through', async () => {
    const { reader } = aStoreAsked();
    const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + 1000;

    const exits = await Promise.all([
      Effect.runPromise(Effect.exit(reader.waitForAppend(alpha, cursorOfParts(['7']), deadline))),
      Effect.runPromise(Effect.exit(reader.waitForAppend(alpha, cursorOfParts(['7', '8']), deadline))),
    ]);

    expect([Exit.isSuccess(exits[0]), Exit.hasDies(exits[1])]).toEqual([true, true]);
  });
});
