import type { FactScope, LedgerStore, StoredAppendedFacts } from '../src/event-store.ts';
import { streamSignalOf } from '../src/signal/append-signal.ts';
import { inTurn, measuredOnEachStore, median, timed, write, type MeasuredStore } from './stores.ts';

const messages = Number(process.env['LEDGER_MEASURE_MESSAGES'] ?? '1000000');

const playbooks = 100;

const waits = Number(process.env['LEDGER_MEASURE_WAITS'] ?? '1000');

const reads = 20;

const context = { at: '2026-10-29T09:00:00.000Z', by: 'measurer' };

const stored = '{"at":"2026-10-29T09:00:00.000Z","by":"measurer"}';

function filled({ name }: MeasuredStore): string {
  return name === 'SQLite'
    ? `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${messages})
      INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata,
        message_schema_version, message_type, message_id)
      SELECT 'playbook/acme/b' || (i % ${playbooks}) || '/runs/r' || (i / 2), (i % 2) + 1, 'emt:default',
        '{"input":null}', '${stored}', '1', 'run_started', 'message-' || i FROM n`
    : `INSERT INTO emt_messages (stream_id, stream_position, message_data, message_metadata, message_schema_version,
        message_type, message_id, transaction_id)
      SELECT 'playbook/acme/b' || (i % ${playbooks}) || '/runs/r' || (i / 2), (i % 2) + 1,
        jsonb_build_object('json', '{"input":null}'), '${stored}', '1', 'run_started', 'message-' || i,
        pg_current_xact_id()
      FROM generate_series(1, ${messages}) AS i`;
}

function playbook(index: number): FactScope {
  return { kind: 'playbook', playbookKey: `playbook/acme/b${index % playbooks}/` };
}

function held(read: StoredAppendedFacts): Extract<StoredAppendedFacts, { readonly held: true }> {
  if (!read.held) {
    throw new Error('The ledger did not hold its own cursor');
  }
  return read;
}

async function readTimes(store: LedgerStore): Promise<readonly [number, number]> {
  const now: number[] = [];
  const fromTheStart: number[] = [];
  await inTurn(
    Array.from({ length: reads + 3 }, (_, index) => index),
    async (index) => {
      const nowTook = await timed(() => store.readAppendedFacts(playbook(index), { most: 1000, dataOf: [] }));
      const startTook = await timed(() =>
        store.readAppendedFacts(playbook(index), { after: null, most: 1000, dataOf: [] }),
      );
      if (index >= 3) {
        now.push(nowTook);
        fromTheStart.push(startTook);
      }
    },
  );
  return [median(now), median(fromTheStart)];
}

function appendedTo(store: LedgerStore, stream: string): Promise<void> {
  return store.append(stream, [{ type: 'noted', data: { note: stream } }], { expectedVersion: 0, context });
}

async function wokenWithin(store: LedgerStore, appending: LedgerStore, stream: string): Promise<readonly number[]> {
  const { through } = held(await store.readAppendedFacts(playbook(1), { most: 1, dataOf: [] }));
  const stopped = new AbortController();
  const woken: number[] = [];
  const started = { at: 0 };
  const waitedFor = async (index: number): Promise<void> => {
    const waited = await store.waitForAppend(playbook(index), through, stopped.signal);
    if (waited === 'appended') {
      woken.push(performance.now() - started.at);
    }
  };
  const waited = Array.from({ length: waits }, (_, index) => waitedFor(index));
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });
  started.at = performance.now();
  await appendedTo(appending, stream);
  await Promise.race([
    Promise.all(waited.filter((_, index) => index % playbooks === 1)),
    new Promise((resolve) => {
      setTimeout(resolve, 5000);
    }),
  ]);
  stopped.abort();
  await Promise.all(waited);
  return woken;
}

async function measured(measuring: MeasuredStore): Promise<void> {
  await measuring.statement(filled(measuring));
  await measuring.statement(measuring.name === 'SQLite' ? 'ANALYZE' : 'VACUUM ANALYZE emt_messages');
  const store = await measuring.opened({ appended: streamSignalOf() });
  const elsewhere = await measuring.opened({ appended: streamSignalOf() });
  const [now, fromTheStart] = await readTimes(store);
  const ownAppend = await wokenWithin(store, store, 'playbook/acme/b1/notes/own');
  const otherAppend = await wokenWithin(store, elsewhere, 'playbook/acme/b1/notes/elsewhere');
  await elsewhere.close();
  await store.close();
  write(
    [
      `| ${measuring.name}`,
      messages.toLocaleString('en'),
      `${now.toFixed(2)} ms`,
      `${fromTheStart.toFixed(2)} ms`,
      `${ownAppend.length} of ${waits.toLocaleString('en')}, ${median(ownAppend).toFixed(1)} ms`,
      `${otherAppend.length} of ${waits.toLocaleString('en')}, ${median(otherAppend).toFixed(0)} ms |`,
    ].join(' | '),
  );
}

write(
  '| Store | Messages | A read from now, median | A read of 1,000 facts from the start, median | Waits ended by an append of the store, median | Waits ended by an append of another store, median |',
);
write('| --- | --- | --- | --- | --- | --- |');
await measuredOnEachStore(measured);
