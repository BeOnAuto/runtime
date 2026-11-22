import { ContextSchema, type Decided, type Decider } from '@on.auto/operations';
import { runTallyRows } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayer } from '../sqlite.ts';
import { alpha, happen, happenings, noted, stamped } from '../testing/happenings.ts';
import { openConnectionWith, openLedgerWith } from '../testing/open-ledger.ts';
import { namedStreamsOf } from './named-store.ts';
import { storeReadsTally } from './store-reads.ts';

async function aLedger() {
  const { ledger, dispose } = await openLedgerWith(ledgerLayer({ fileName: ':memory:', projections: [runTallyRows] }));
  onTestFinished(dispose);
  return ledger;
}

const RunFactSchema = Schema.Struct({
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.String),
  context: ContextSchema,
});

type RunFact = Decided<typeof RunFactSchema.Type>;

const runFacts: Decider<null, readonly RunFact[], typeof RunFactSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
  context: () => stamped,
  eventSchema: RunFactSchema,
};

const ofTheRun = (at: string): RunFact => ({ type: 'run_began', data: { at, fn: 'greet' } });

describe('the reads of a ledger on SQLite, named by what they read', () => {
  it('names a fold by its kind of stream and counts the facts it folded', async () => {
    const ledger = await aLedger();
    await happen(ledger, 'org/acme/playbooks', noted('one'), noted('two'), noted('three'));
    const tally = storeReadsTally();

    await tally.run(() => Effect.runPromise(ledger.load('org/acme/playbooks', happenings)));

    expect(tally.taken()).toEqual({ 'fold:org.playbooks': { n: 1, rows: 3, events: 3 } });
  });

  it('names a read of a keyed projection by its table, version and all', async () => {
    const ledger = await aLedger();
    await Effect.runPromise(
      ledger.execute('playbook/acme/alpha/runs/r1', runFacts, [ofTheRun('2026-11-22T09:00:00.000Z')]),
    );
    const tally = storeReadsTally();

    await tally.run(() =>
      Effect.runPromise(
        ledger.readProjectedRows('run_tallies', alpha, { where: [], orderBy: ['began_at'], order: 'desc', limit: 5 }),
      ),
    );

    expect(tally.taken()).toEqual({ run_tallies_2: { n: 1, rows: 1 } });
  });

  it('names a command by the fold it decided on, its append and the rows each projection wrote', async () => {
    const ledger = await aLedger();
    const tally = storeReadsTally();

    await tally.run(() =>
      Effect.runPromise(
        ledger.execute('playbook/acme/alpha/runs/r1', runFacts, [ofTheRun('2026-11-22T09:00:00.000Z')]),
      ),
    );

    const reads = tally.taken();
    expect(Object.keys(reads)).toEqual(
      expect.arrayContaining(['fold:playbook.runs', 'append:playbook.runs', 'run_tallies_2']),
    );
    expect(reads['run_tallies_2']).toMatchObject({ written: 1 });
    expect(reads['fold:playbook.runs']).toMatchObject({ n: 1 });
  });
});

describe('the reads a ledger names, outside a call and on its connection', () => {
  it('names nothing of a ledger read outside a call', async () => {
    const ledger = await aLedger();

    await happen(ledger, 'org/acme/playbooks', noted('one'));

    expect(await Effect.runPromise(ledger.load('org/acme/playbooks', happenings))).toMatchObject({ version: 1 });
  });

  it('names the reads of the streams the ledger lends its connection, and adds no read a store lacks', async () => {
    const { connection, dispose } = await openConnectionWith(ledgerLayer({ fileName: ':memory:' }));
    onTestFinished(dispose);
    const { lastPositionOf, ...withoutPositions } = connection.streams;
    const tally = storeReadsTally();

    await tally.run(() => connection.streams.read('org/acme/playbooks'));

    expect(tally.taken()).toEqual({ 'fold:org.playbooks': { n: 1 } });
    expect([typeof lastPositionOf, 'lastPositionOf' in namedStreamsOf(withoutPositions)]).toEqual(['function', false]);
  });
});
