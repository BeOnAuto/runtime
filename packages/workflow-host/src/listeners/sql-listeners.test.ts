import { statement, textOnPostgreSQL } from '@on.auto/ledger';
import type { ArmListener } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { type HostDatabase, rowsOf, WholeNumber } from '../database/host-database.ts';
import { sqlWatermark } from '../dispatch/sql-watermark.ts';
import { type FilterPlace, filterStops } from '../filtering/filter-matching.ts';
import { runGateOf } from '../follower/run-gate.ts';
import { refusalsOn } from '../reactions/refusals.ts';
import { onPostgreSQLAt, onSQLite, openedOn } from '../testing/host-files.ts';
import { describeOnPostgreSQL } from '../testing/postgresql-databases.ts';
import { faultyWithARun, runKeyAt, startedIn } from '../testing/started-runs.ts';
import { insertedListener } from './listener-rows.ts';
import { mostListenersInAPlaybook, sqlListeners } from './sql-listeners.ts';

const attributes = { definition: { name: 'await-approval', version: 1 }, caller: { id: 'acme-admin' } };

const listening = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherListening = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const run = { runId: runKeyAt(listening), attributes };

const armedBy = { version: 3 };

function listenerAt(reference: string): ArmListener {
  return { kind: 'arm_listener', key: { runId: run.runId, reference, run: 1 }, filters: [{ type: 'go' }] };
}

function awaitingKeyOf(runId: string) {
  return { runId, reference: '/do/0/await', run: 1 };
}

const RefusalRow = Schema.Struct({ workflow: Schema.String, reason: Schema.String });

const playbookKey = 'playbook/acme/alpha/';

const definitionKey = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-00000000de01/';

const runKey = 'acme/0199a3c4-7d2e-7c1a-9b3f-00000000de01/r-1';

const stream = `${definitionKey}run-logs/r-1`;

type RecordedEvent = Parameters<ReturnType<typeof runGateOf>['verdictOn']>[0];

const PassedRow = Schema.Struct({ listener: Schema.String, passed: WholeNumber });

async function connected(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

const record: RecordedEvent = {
  id: 'record-2',
  cursor: 'cursor-2',
  causationId: null,
  correlationId: null,
  stream,
  version: 2,
  globalPosition: 2,
  type: 'input_applied',
  data: null,
  context: { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' },
  recordedAt: '2026-10-01T09:00:00.000Z',
};

interface Holding {
  readonly held: Readonly<Pick<Client, 'query'>>;
  readonly insertInto: string;
  readonly meanwhile: () => Promise<unknown>;
}

function holdingTheInsert(database: HostDatabase, { held, insertInto, meanwhile }: Holding): HostDatabase {
  return {
    ...database,
    write: (written) =>
      written.strings.join('').includes(`INSERT INTO ${insertInto}`)
        ? Effect.promise(async () => {
            await held.query('BEGIN');
            await held.query(textOnPostgreSQL(written), [...written.values]);
            await meanwhile();
            await held.query('COMMIT');
            return [];
          })
        : database.write(written),
  };
}

function passedEarlyTests(aDatabase: () => Promise<string>): void {
  describe('a listener kept while the gate passes its run early', () => {
    it('is marked passed though its insert was still open when the gate marked the run passed', async () => {
      const connectionString = await aDatabase();
      const database = await openedOn(onPostgreSQLAt(connectionString));
      const held = await connected(connectionString);
      await Effect.runPromise(
        database.write(
          statement`INSERT INTO workflow_runs (run_key, stream_id, dispatched_through) VALUES (${runKey}, ${stream}, ${0})`,
        ),
      );
      const passing = () => Effect.runPromise(runGateOf(database).verdictOn(record, true));

      await Effect.runPromise(
        insertedListener(holdingTheInsert(database, { held, insertInto: 'workflow_listeners', meanwhile: passing }), {
          runKey,
          listener: 'held',
          playbookKey,
          streamId: stream,
          armedBy: 2,
          filters: '[]',
          workflow: 'wait',
          version: 1,
          passed: false,
        }),
      );
      const listeners = await Effect.runPromise(
        rowsOf(PassedRow, database.read(statement`SELECT listener, passed FROM workflow_listeners`)),
      );

      expect(listeners).toEqual([{ listener: 'held', passed: 1 }]);
    });
  });
}

function catchingUpTests(aDatabase: () => Promise<string>): void {
  describe('the note of a run passed early while its dispatch catches up', () => {
    it('is taken back when the dispatch reached the record while the note was still being written', async () => {
      const connectionString = await aDatabase();
      const database = await openedOn(onPostgreSQLAt(connectionString));
      const held = await connected(connectionString);
      await Effect.runPromise(
        database.write(
          statement`INSERT INTO workflow_runs (run_key, stream_id, dispatched_through) VALUES (${runKey}, ${stream}, ${0})`,
        ),
      );
      const catchingUp = () => Effect.runPromise(sqlWatermark(database).advance(runKey, 2));
      const holding = holdingTheInsert(database, { held, insertInto: 'workflow_passed_runs', meanwhile: catchingUp });

      const verdict = await Effect.runPromise(runGateOf(holding).verdictOn(record, true));
      const left = await Effect.runPromise(database.read(statement`SELECT run_key FROM workflow_passed_runs`));

      expect([verdict, left]).toEqual(['overdue', []]);
    });
  });
}

describe('the listeners of a playbook', () => {
  it('are 4,096 in a playbook at most: one more is refused and said, and its run takes only the events sent to it', async () => {
    const database = await startedIn(await openedOn(await onSQLite()), listening);
    const listeners = sqlListeners(database, refusalsOn(database, 'workflow', Date.now), filterStops());
    await Effect.runPromise(
      database.write(
        statement`WITH RECURSIVE listening (at) AS (
            SELECT 1 UNION ALL SELECT at + 1 FROM listening WHERE at < ${mostListenersInAPlaybook - 1}
          )
          INSERT INTO workflow_listeners (run_key, listener, playbook_key, stream_id, armed_by, filters, workflow, version, passed)
          SELECT 'acme/alpha/r' || at, 'listener', 'playbook/acme/alpha/', 'playbook/acme/alpha/run-logs/r' || at, 1, '[]',
            'other', 1, 1
          FROM listening`,
      ),
    );

    const receipts = await Effect.runPromise(
      Effect.forEach(['/do/0/await', '/do/1/await'], (reference) => listeners.arm(listenerAt(reference), run, armedBy)),
    );
    const refusals = await Effect.runPromise(
      rowsOf(RefusalRow, database.read(statement`SELECT workflow, reason FROM workflow_reaction_refusals`)),
    );

    expect(receipts).toEqual(['armed', 'refused']);
    expect(refusals).toEqual([
      {
        workflow: 'await-approval',
        reason:
          'A run listened for events of the playbook while 4096 listeners were already open in it, the most a playbook keeps; the run takes only the events sent to it',
      },
    ]);
  });
});

describe('the stops of the filter of a listen task', () => {
  it('are kept while another run listens at the task of that version, and forgotten when the last such listener is cancelled', async () => {
    const database = await startedIn(await startedIn(await openedOn(await onSQLite()), listening), otherListening);
    const stops = filterStops();
    const listeners = sqlListeners(database, refusalsOn(database, 'workflow', Date.now), stops);
    const other = { ...run, runId: runKeyAt(otherListening) };
    const place: FilterPlace = {
      kind: 'listener',
      playbookKey: 'playbook/acme/alpha/',
      workflow: 'await-approval',
      version: 1,
      reference: '/do/0/await',
    };
    await Effect.runPromise(
      listeners.arm({ ...listenerAt('/do/0/await'), key: awaitingKeyOf(run.runId) }, run, armedBy),
    );
    await Effect.runPromise(
      listeners.arm({ ...listenerAt('/do/0/await'), key: awaitingKeyOf(other.runId) }, other, armedBy),
    );
    stops.judged(place, 0, { error: { type: 'runtime', status: 500, instance: '/do/0/await' }, stopped: true });

    await Effect.runPromise(listeners.cancel({ kind: 'cancel_listener', key: awaitingKeyOf(run.runId) }, run));
    const whileAnotherListens = stops.holds(place);
    await Effect.runPromise(listeners.cancel({ kind: 'cancel_listener', key: awaitingKeyOf(other.runId) }, other));

    expect([whileAnotherListens, stops.holds(place)]).toEqual([true, false]);
  });
});

describe('a listener the host tables cannot record', () => {
  it('fails to arm or cancel, to be dispatched again', async () => {
    const database = await faultyWithARun(listening);
    const listeners = sqlListeners(database, refusalsOn(database, 'workflow', Date.now), filterStops());
    const listener = listenerAt('/do/0/await');
    database.failing(true);

    const failures = await Effect.runPromise(
      Effect.all([
        Effect.flip(listeners.arm(listener, run, armedBy)),
        Effect.flip(listeners.cancel({ kind: 'cancel_listener', key: listener.key }, run)),
      ]),
    );

    expect(failures).toEqual([
      expect.objectContaining({ output: 'arm_listener' }),
      expect.objectContaining({ output: 'cancel_listener' }),
    ]);
  });
});

describeOnPostgreSQL('the gate of a run', (aDatabase) => {
  passedEarlyTests(aDatabase);
  catchingUpTests(aDatabase);
});
