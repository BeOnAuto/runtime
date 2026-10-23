import { statement } from '@on.auto/ledger';
import type { ArmListener } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf } from '../database/host-database.ts';
import { filterStops, type FilterPlace } from '../filtering/filter-matching.ts';
import { refusalsOn } from '../reactions/refusals.ts';
import { faultyDatabase } from '../testing/faulty-database.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { mostListenersInAPlaybook, sqlListeners } from './sql-listeners.ts';

const attributes = { definition: { name: 'await-approval', version: 1 }, caller: { id: 'acme-admin' } };

const run = { runId: 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', attributes };

const armedBy = { version: 3 };

function listenerAt(reference: string): ArmListener {
  return { kind: 'arm_listener', key: { runId: run.runId, reference, run: 1 }, filters: [{ type: 'go' }] };
}

function awaitingKeyOf(runId: string) {
  return { runId, reference: '/do/0/await', run: 1 };
}

const RefusalRow = Schema.Struct({ workflow: Schema.String, reason: Schema.String });

describe('the listeners of a playbook', () => {
  it('are 4,096 in a playbook at most: one more is refused and said, and its run takes only the events sent to it', async () => {
    const database = await openedOn(await onSQLite());
    const listeners = sqlListeners(database, refusalsOn(database, Date.now), filterStops());
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
    const database = await openedOn(await onSQLite());
    const stops = filterStops();
    const listeners = sqlListeners(database, refusalsOn(database, Date.now), stops);
    const other = { ...run, runId: 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b' };
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
    const database = faultyDatabase(await openedOn(await onSQLite()));
    const listeners = sqlListeners(database, refusalsOn(database, Date.now), filterStops());
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
