import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { appendedFactsBehaviour } from '../changes-testing/appended-facts-behaviour.ts';
import { ContextSchema, type Decided, type Decider } from '../index.ts';
import { memoryLedger } from './memory-ledger.ts';

appendedFactsBehaviour({ aLedger: () => Promise.resolve(memoryLedger().service) });

const NotedSchema = Schema.Struct({
  type: Schema.Literal('noted'),
  data: Schema.Struct({ note: Schema.String }),
  context: ContextSchema,
});

type Noted = typeof NotedSchema.Type;

const notes: Decider<readonly string[], readonly Decided<Noted>[], Noted> = {
  initialState: [],
  evolve: (seen, { data }) => [...seen, data.note],
  decide: (noted) => Result.succeed(noted),
  context: () => ({ at: '2026-11-15T09:00:00.000Z', by: 'tester' }),
  eventSchema: NotedSchema,
};

function notedAs(...said: readonly string[]): readonly Decided<Noted>[] {
  return said.map((note) => ({ type: 'noted', data: { note } }));
}

describe('a fold of the memory ledger whose state is its last fact alone', () => {
  it('reads that fact and no other, at the version of the stream, as the ledger does', async () => {
    const ledger = memoryLedger();
    const stream = 'playbook/acme/alpha/notes';

    const loads = await Effect.runPromise(
      ledger.service
        .execute(stream, notes, notedAs('first', 'second'))
        .pipe(
          Effect.andThen(ledger.service.execute(stream, notes, notedAs('third'))),
          Effect.andThen(
            Effect.all([
              ledger.service.load(stream, notes),
              ledger.service.load(stream, { ...notes, lastFactAlone: true }),
              ledger.service.load('playbook/acme/alpha/nothing', { ...notes, lastFactAlone: true }),
            ]),
          ),
        ),
    );

    expect(loads).toEqual([
      { state: ['first', 'second', 'third'], version: 3 },
      { state: ['third'], version: 3 },
      { state: [], version: 0 },
    ]);
  });
});
