import { Effect, Exit, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ActedContextSchema } from '../ledger/context.ts';
import { factOf, type Decider } from '../ledger/decider.ts';
import { Conflict } from '../outcome/conflict.ts';
import { memoryLedger } from './memory-ledger.ts';

const CountedSchema = factOf('counted', Schema.Struct({ by: Schema.Number }), ActedContextSchema);

const counting: Decider<number, number, typeof CountedSchema.Type, 'conflict'> = {
  initialState: 0,
  evolve: (total, { data }) => total + data.by,
  eventSchema: CountedSchema,
  decide: (by) =>
    by < 0
      ? Result.fail(new Conflict({ detail: 'A count goes up' }))
      : Result.succeed(by === 0 ? [] : [{ type: 'counted', data: { by } }]),
  context: () => ({ at: '2026-11-19T09:00:00.000Z', by: 'tester' }),
};

const first = 'playbook/acme/alpha/counts/first';

const second = 'playbook/acme/alpha/counts/second';

function counted(stream: string, by: number) {
  return { stream, decider: counting, command: by };
}

describe('an execute of the in-memory ledger over several streams', () => {
  it('appends the facts of every decision at once, answering each state, and appends nothing for a decision of none', async () => {
    const ledger = memoryLedger();

    const answered = await Effect.runPromise(
      ledger.service.executeMultiStream([counted(first, 2), counted(second, 0)]),
    );

    expect(answered).toEqual([
      { state: 2, version: 1, decidedOn: 0 },
      { state: 0, version: 0, decidedOn: 0 },
    ]);
    expect(ledger.streamNames()).toEqual([first]);
  });

  it('appends nothing when one decision rejects, and answers its rejection', async () => {
    const ledger = memoryLedger();

    const exit = await Effect.runPromiseExit(
      ledger.service.executeMultiStream([counted(first, 2), counted(second, -1)]),
    );

    expect(exit).toEqual(Exit.fail(new Conflict({ detail: 'A count goes up' })));
    expect(ledger.streamNames()).toEqual([]);
  });

  it('appends nothing when another write moved one of its streams while it decided, as a concurrent change', async () => {
    const ledger = memoryLedger();

    const [several] = await Effect.runPromise(
      Effect.all(
        [
          Effect.exit(ledger.service.executeMultiStream([counted(first, 2), counted(second, 3)])),
          ledger.service.execute(second, counting, 1),
        ],
        { concurrency: 'unbounded' },
      ),
    );

    expect(several).toEqual(
      Exit.fail(new Conflict({ detail: 'The state changed while the command was decided', kind: 'concurrent_change' })),
    );
    expect(ledger.streamNames()).toEqual([second]);
  });
});
