import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Effect, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { dataAsWritten, emmettEventStore } from '../emmett/emmett-event-store.ts';
import { eventAppenderOf, streamAppends, streamSignalOf, VersionConflict } from '../index.ts';
import { ledgerLayer } from '../sqlite3.ts';
import { happenings, noted } from '../testing/happenings.ts';
import { stamped } from '../testing/happenings.ts';
import { openLedgerWith, outcomeOf } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';

async function aStoreSignalling(appended: ReturnType<typeof streamSignalOf>) {
  const emmett = getSQLiteEventStore({
    driver: sqlite3EventStoreDriver,
    fileName: ':memory:',
    schema: { autoMigration: 'None' },
  });
  onTestFinished(() => emmett.close());
  const store = emmettEventStore(emmett, { data: dataAsWritten, mostEventsInOneAppend: 8, appended });
  await store.migrate();
  return store;
}

const one = [{ type: 'noted', data: { n: 1 } }];

describe('the signal an append raises', () => {
  it('names every stream appended to, after the append', async () => {
    const signal = streamSignalOf();
    const heard: string[] = [];
    signal.listen((playbookKey) => {
      heard.push(playbookKey);
    });
    const store = await aStoreSignalling(signal);

    await store.append('playbook/acme/alpha/events/e1', one, { expectedVersion: 0, context: stamped });
    await store.append('org/acme/playbooks', one, { expectedVersion: 0, context: stamped });
    await store.append('playbook/acme/Beta_2/run-logs/r1', one, { expectedVersion: 0, context: stamped });

    expect(heard).toEqual(['playbook/acme/alpha/events/e1', 'org/acme/playbooks', 'playbook/acme/Beta_2/run-logs/r1']);
  });

  it('is not raised by an append that met a version conflict, nor heard once a listener has stopped', async () => {
    const signal = streamSignalOf();
    const heard: string[] = [];
    const stop = signal.listen((playbookKey) => {
      heard.push(playbookKey);
    });
    const store = await aStoreSignalling(signal);
    await store.append('playbook/acme/alpha/notes', one, { expectedVersion: 0, context: stamped });

    const conflicted = await outcomeOf(
      eventAppenderOf(store, tally.eventSchema)('playbook/acme/alpha/notes', [{ type: 'counted', data: { by: 1 } }], {
        expectedVersion: 0,
        context: stamped,
      }),
    );
    stop();
    await store.append('playbook/acme/alpha/notes', one, { expectedVersion: 1, context: stamped });

    expect([conflicted, heard]).toEqual([Result.fail(new VersionConflict()), ['playbook/acme/alpha/notes']]);
  });
});

describe('the signal of the process', () => {
  it('is the signal when none is given, so every ledger of the process raises it', async () => {
    const heard: string[] = [];
    const stop = streamAppends.listen((playbookKey) => {
      heard.push(playbookKey);
    });
    onTestFinished(stop);
    const { ledger, dispose } = await openLedgerWith(ledgerLayer({ fileName: ':memory:' }));
    onTestFinished(dispose);

    await Effect.runPromise(ledger.execute('playbook/acme/gamma/notes', happenings, [noted('noted')]));

    expect(heard).toContain('playbook/acme/gamma/notes');
  });
});
