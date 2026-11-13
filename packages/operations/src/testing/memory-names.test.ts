import { Effect, Exit, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionNames } from '../definition-names/name-judgement.ts';
import { ActedContextSchema } from '../ledger/context.ts';
import { factOf, type Decider } from '../ledger/decider.ts';
import { namesAtThePortBehaviour } from '../names-testing/names-behaviour.ts';
import { Conflict } from '../outcome/conflict.ts';
import type { KeyedProjection } from '../projections/keyed-projection.ts';
import { memoryLedger, memoryLedgerWith } from './memory-ledger.ts';

describe('the in-memory ledger', () => {
  namesAtThePortBehaviour({
    keeping: (definitionNames) => {
      const { service, names } = memoryLedgerWith({ definitionNames });
      return Promise.resolve({ ledger: service, names: () => Promise.resolve(names()) });
    },
  });
});

const NotedSchema = factOf('noted', Schema.Struct({}), ActedContextSchema);

const noting: Decider<null, null, typeof NotedSchema.Type> = {
  initialState: null,
  evolve: (state) => state,
  eventSchema: NotedSchema,
  decide: () => Result.succeed([{ type: 'noted', data: {} }]),
  context: () => ({ at: '2026-11-13T09:00:00.000Z', by: 'tester' }),
};

describe('the in-memory ledger told of no names', () => {
  it('keeps none', async () => {
    const ledger = memoryLedger();

    await Effect.runPromise(ledger.service.execute('playbook/acme/alpha/definitions/reasoning', noting, null));

    expect(ledger.names()).toEqual([]);
  });
});

const MadeSchema = factOf(
  'made',
  Schema.Struct({ definition: Schema.String, name: Schema.String }),
  ActedContextSchema,
);

const making: Decider<null, null, typeof MadeSchema.Type> = {
  initialState: null,
  evolve: (state) => state,
  eventSchema: MadeSchema,
  decide: () => Result.succeed([{ type: 'made', data: { definition: 'a', name: 'triage' } }]),
  context: () => ({ at: '2026-11-13T09:00:00.000Z', by: 'tester' }),
};

const failingRows: KeyedProjection = {
  name: 'failing',
  version: 1,
  kinds: ['definitions'],
  types: ['made'],
  columns: [{ name: 'note', kind: 'text' }],
  indexes: [],
  rowAfter: () => {
    throw new Error('The mapping failed');
  },
};

const madeNames: DefinitionNames = {
  types: ['made'],
  definitionKeyOf: () => 'definition/acme/a/',
  nameAfter: () => ({
    playbookKey: 'playbook/acme/alpha/',
    definitionType: 'reasoning',
    name: 'triage',
    status: 'active',
    hasTriggers: false,
  }),
  takenBy: () => new Conflict({ detail: 'The name is taken', kind: 'taken' }),
};

describe('the in-memory ledger, when a mapping of the append fails', () => {
  it('keeps nothing of the append, its names included, as a store keeps nothing', async () => {
    const ledger = memoryLedgerWith({ projections: [failingRows], definitionNames: madeNames });

    const exit = await Effect.runPromiseExit(
      ledger.service.execute('playbook/acme/alpha/definitions/reasoning', making, null),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect([ledger.names(), ledger.streamNames()]).toEqual([[], []]);
  });
});
