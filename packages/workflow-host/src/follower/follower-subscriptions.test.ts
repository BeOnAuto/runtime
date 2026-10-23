import { statement } from '@on.auto/ledger';
import { messageIdOf } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf } from '../database/host-database.ts';
import {
  alpha,
  at,
  eventTrigger,
  published,
  definitionRecorded,
  definitionRetired,
} from '../reaction-testing/playbook-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { refusedWhile, rejectedFor } from '../reaction-testing/recorded-reactions.ts';
import { reactionRunIdOf } from '../reactions/reaction-ids.ts';
import { until } from '../testing/until.ts';

const closed = eventTrigger({ type: 'com.acme.closed' });

const sentinel = eventTrigger({ type: 'com.acme.sentinel' });

const RefusalRow = Schema.Struct({ reason: Schema.String });

function startedWorkflows({ reactions }: ReactingHost): readonly string[] {
  return reactions.starts().map(({ workflow }) => workflow);
}

function startsReaching(reacting: ReactingHost, count: number) {
  return until(
    () => Promise.resolve(reacting.reactions.starts()),
    (starts) => starts.length >= count,
  );
}

async function sentinelPassed(reacting: ReactingHost, id: string): Promise<void> {
  await published(reacting.database.store, { id, type: 'com.acme.sentinel' });
  await until(
    () => Promise.resolve(startedWorkflows(reacting)),
    (workflows) => workflows.includes('watch'),
  );
}

describe('a workflow whose trigger is an event', () => {
  it('is started once for each event that matches, with the event as its input and its trace, and for no other', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    const trigger = eventTrigger({ type: 'com.acme.closed', data: { region: 'eu' } });
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [trigger] });

    await published(store, { id: 'e1', type: 'com.acme.closed', data: { region: 'eu' } });
    await published(store, { id: 'e2', type: 'com.acme.closed', data: { region: 'us' } });
    await published(store, { id: 'e3', type: 'com.acme.opened', data: { region: 'eu' } });
    const starts = await startsReaching(reacting, 1);
    const cause = messageIdOf(`${alpha}events/e1`, 1);
    const kept = await store.readRecordedEvent(alpha, cause);

    expect(starts).toEqual([
      {
        org: 'acme',
        playbook: 'alpha',
        workflow: 'close',
        version: 1,
        runId: reactionRunIdOf('close', 1, '/schedule/on', cause),
        input: [
          { specversion: '1.0', source: '/acme', time: at, id: 'e1', type: 'com.acme.closed', data: { region: 'eu' } },
        ],
        depth: 1,
        cause,
        trigger: { kind: 'event', reference: '/schedule/on' },
        trace: { traceId: kept?.metadata.traceId, spanId: kept?.metadata.spanId },
      },
    ]);
  });
});

describe('the records a workflow whose trigger is an event reacts to', () => {
  it('are none before the record that activated it, and none after the one that retired it', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [sentinel] });
    await published(store, { id: 'early', type: 'com.acme.closed' });
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] });
    await published(store, { id: 'between', type: 'com.acme.closed' });
    await definitionRetired(store, 'close', 1);
    await published(store, { id: 'late', type: 'com.acme.closed' });

    await sentinelPassed(reacting, 's1');

    expect(reacting.reactions.starts().filter(({ workflow }) => workflow === 'close')).toHaveLength(1);
  });
});

describe('a new version of a workflow whose trigger is an event', () => {
  it('replaces the trigger of the version before, and a version without a trigger reacts to nothing', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [sentinel] });
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] });
    await definitionRecorded(store, {
      name: 'close',
      version: 2,
      triggers: [eventTrigger({ type: 'com.acme.opened' })],
    });
    await published(store, { id: 'closed', type: 'com.acme.closed' });
    await published(store, { id: 'opened', type: 'com.acme.opened' });
    await definitionRecorded(store, { name: 'close', version: 3, triggers: [] });
    await published(store, { id: 'opened-again', type: 'com.acme.opened' });

    await sentinelPassed(reacting, 's1');

    expect(reacting.reactions.starts().map(({ workflow, version, cause }) => [workflow, version, cause])).toEqual([
      ['close', 2, messageIdOf(`${alpha}events/opened`, 1)],
      ['watch', 1, messageIdOf(`${alpha}events/s1`, 1)],
    ]);
  });
});

describe('the follower of a playbook', () => {
  it('starts nothing again for what it delivered before the host stopped, and goes on after it', async () => {
    const first = await reactingHost();
    const { store } = first.database;
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] });
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [sentinel] });
    await published(store, { id: 'e1', type: 'com.acme.closed' });
    await startsReaching(first, 1);
    await first.host.stop();

    const second = await reactingHost({ settings: first.settings });
    await published(second.database.store, { id: 'e2', type: 'com.acme.closed' });
    await sentinelPassed(second, 's1');

    expect([first.reactions.starts().length, startedWorkflows(second)]).toEqual([1, ['close', 'watch']]);
  });
});

describe('a start the playbook keeps refusing', () => {
  it('holds the follower of the playbook for 20 sweeps, then is skipped and said, and the follower goes on', async () => {
    const refusing = { now: true };
    const reacting = await reactingHost({ failure: refusedWhile(refusing) });
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] });
    await published(store, { id: 'e1', type: 'com.acme.closed' });

    const refusals = await until(
      () =>
        Effect.runPromise(
          rowsOf(RefusalRow, reacting.database.read(statement`SELECT reason FROM workflow_reaction_refusals`)),
        ),
      (found) => found.length > 0,
    );
    refusing.now = false;
    await published(store, { id: 'e2', type: 'com.acme.closed' });
    const starts = await startsReaching(reacting, 1);

    expect([refusals, starts.map(({ cause }) => cause)]).toEqual([
      [{ reason: 'The workflow could not be started by its event trigger: The playbook refused the start' }],
      [messageIdOf(`${alpha}events/e2`, 1)],
    ]);
  });
});

describe('a start the playbook rejects for good', () => {
  it('is said at once and not tried again, and the follower goes on', async () => {
    const reacting = await reactingHost({
      failure: rejectedFor('close', 'The input is not what the workflow takes'),
    });
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] });
    await published(store, { id: 'e1', type: 'com.acme.closed' });
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [sentinel] });

    await sentinelPassed(reacting, 's1');
    const refusals = await Effect.runPromise(
      rowsOf(RefusalRow, reacting.database.read(statement`SELECT reason FROM workflow_reaction_refusals`)),
    );

    expect([refusals, startedWorkflows(reacting)]).toEqual([
      [{ reason: 'The workflow could not be started by its event trigger: The input is not what the workflow takes' }],
      ['watch'],
    ]);
  });
});
