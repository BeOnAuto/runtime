import type { Trigger } from '@on.auto/definitions';
import type { LedgerStreams } from '@on.auto/ledger';
import { messageIdOf } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { about, applying, first, retired, row, rowsIn, saved } from '../reaction-testing/applied-records.ts';
import {
  pausesOf,
  refusalsSaid,
  runEnded,
  runStillGoing,
  startsReaching,
  triggerRowsOf,
  untilTriggersAt,
} from '../reaction-testing/kept-triggers.ts';
import {
  alpha,
  at,
  byAdmin,
  cronTrigger,
  definitionStreamNamed,
  definitionRecordAt,
  definitionRecorded,
  definitionRetired,
  eventTrigger,
  everyTrigger,
  playbookCreated,
  published,
  recorded,
} from '../reaction-testing/playbook-writes.ts';
import { keptDefinition, steppedReacting, type SteppedReacting } from '../reaction-testing/stepped-reactions.ts';
import { aLedgerInMemory, openedOn } from '../testing/host-files.ts';
import { fewSweeps } from '../testing/stepped-clock.ts';
import type { DefinitionRecord } from './definition-records.ts';
import { triggerChangesOf } from './trigger-changes.ts';

const activatedAt = Date.parse(at);

const aMinute = 60_000;

const watching = eventTrigger({ type: 'com.acme.sentinel' });

function isoAt(minutes: number): string {
  return new Date(activatedAt + minutes * aMinute).toISOString();
}

async function tickingEveryMinute() {
  const stepped = await steppedReacting();
  const { reacting, clock, sweeps } = stepped;
  await keptDefinition(stepped, { name: 'tick', version: 1, triggers: [everyTrigger(aMinute)] });
  clock.moveTo(activatedAt + aMinute);
  const [firstTriggerVersions] = await startsReaching(sweeps, reacting.reactions.starts, 1);
  await runStillGoing(reacting.database, firstTriggerVersions?.runId ?? '');
  return { reacting, clock, sweeps, running: firstTriggerVersions?.runId ?? '' };
}

async function sentinelPassed({ reacting, sweeps }: SteppedReacting, count: number) {
  await published(reacting.database.store, { id: 'sentinel', type: 'com.acme.sentinel' });
  return startsReaching(sweeps, reacting.reactions.starts, count);
}

async function definitionsOfThePlaybook(store: LedgerStreams): Promise<void> {
  const closed = eventTrigger({ type: 'com.acme.closed' });
  await playbookCreated(store, 'alpha');
  await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed, everyTrigger(15 * aMinute)] });
  await definitionRecorded(store, {
    name: 'close',
    version: 2,
    triggers: [closed, everyTrigger(15 * aMinute), cronTrigger('0 18 * * *')],
    when: isoAt(1),
  });
  await definitionRecorded(store, {
    name: 'close',
    version: 3,
    triggers: [eventTrigger({ type: 'com.acme.opened' }), everyTrigger(15 * aMinute)],
    when: isoAt(2),
  });
  await definitionRecorded(store, { name: 'tick', version: 1, triggers: [everyTrigger(aMinute)] });
  await definitionRecorded(store, { name: 'tick', version: 2, triggers: [everyTrigger(2 * aMinute)], when: isoAt(3) });
}

const restoredAt = first + 50 * aMinute;

const resumedAt = first + 60 * aMinute;

function restored(id: string, name: string, triggers: readonly Trigger[], atRestoredRecords: number): DefinitionRecord {
  return {
    id,
    type: 'definition_restored',
    data: { content: { source: 'schedule: {}', triggers }, restored_by: { id: 'acme-admin', name: 'acme-admin' } },
    context: about(name, 1, new Date(atRestoredRecords).toISOString()),
  };
}

function resumed(id: string, name: string, atRestoredRecords: number): DefinitionRecord {
  return {
    id,
    type: 'definition_resumed',
    data: {},
    context: about(name, 1, new Date(atRestoredRecords).toISOString()),
  };
}

describe('a version that leaves the triggers of the one before unchanged', () => {
  it('keeps their anchor, their next due time and their running run, and the next run is of the new version', async () => {
    const { reacting, clock, sweeps, running } = await tickingEveryMinute();
    const { database } = reacting;
    await definitionRecorded(database.store, {
      name: 'tick',
      version: 2,
      triggers: [everyTrigger(aMinute)],
      when: isoAt(1.5),
    });
    await untilTriggersAt(sweeps, database, 'tick', 2);

    clock.moveTo(activatedAt + 2 * aMinute);
    const refusals = await refusalsSaid(sweeps, database);
    await runEnded(database, running);
    clock.moveTo(activatedAt + 3 * aMinute);
    const [, next] = await startsReaching(sweeps, reacting.reactions.starts, 2);

    expect(refusals.map(({ reason }) => reason)).toEqual([
      `The run scheduled for ${isoAt(2)} by its every schedule was skipped: the run it started before is still running`,
    ]);
    expect([next?.version, next?.input, next?.cause]).toEqual([
      2,
      { schedule: { due: isoAt(3) } },
      definitionRecordAt('tick', 1),
    ]);
  });
});

describe('a version that changes an every schedule', () => {
  it('counts it from its own record, and skips while a run the version before started still runs', async () => {
    const { reacting, clock, sweeps, running } = await tickingEveryMinute();
    const { database } = reacting;
    await definitionRecorded(database.store, {
      name: 'tick',
      version: 2,
      triggers: [everyTrigger(2 * aMinute)],
      when: isoAt(1.5),
    });
    await untilTriggersAt(sweeps, database, 'tick', 2);

    clock.moveTo(activatedAt + 3.5 * aMinute);
    const refusals = await refusalsSaid(sweeps, database);
    await runEnded(database, running);
    clock.moveTo(activatedAt + 5.5 * aMinute);
    const [, next] = await startsReaching(sweeps, reacting.reactions.starts, 2);

    expect(refusals.map(({ reason }) => reason)).toEqual([
      `The run scheduled for ${isoAt(3.5)} by its every schedule was skipped: the run it started before is still running`,
    ]);
    expect([next?.version, next?.input, next?.cause]).toEqual([
      2,
      { schedule: { due: isoAt(5.5) } },
      definitionRecordAt('tick', 2),
    ]);
  });
});

describe('a version that changes the event trigger', () => {
  it('matches nothing recorded before it, while what matched before it starts the version before', async () => {
    const stepped = await steppedReacting();
    const { reacting } = stepped;
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [watching] });
    await definitionRecorded(store, {
      name: 'close',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.closed' })],
    });
    await published(store, { id: 'closed-before', type: 'com.acme.closed' });
    await published(store, { id: 'opened-before', type: 'com.acme.opened' });
    await definitionRecorded(store, {
      name: 'close',
      version: 2,
      triggers: [eventTrigger({ type: 'com.acme.opened' })],
    });
    await published(store, { id: 'closed-after', type: 'com.acme.closed' });
    await published(store, { id: 'opened-after', type: 'com.acme.opened' });

    const starts = await sentinelPassed(stepped, 3);

    expect(starts.map(({ workflow, version, cause }) => [workflow, version, cause])).toEqual([
      ['close', 1, messageIdOf(`${alpha}events/closed-before`, 1)],
      ['close', 2, messageIdOf(`${alpha}events/opened-after`, 1)],
      ['watch', 1, messageIdOf(`${alpha}events/sentinel`, 1)],
    ]);
  });
});

describe('a version that removes a cron schedule', () => {
  it('fires it no more, while its every schedule goes on', async () => {
    const stepped = await steppedReacting();
    const { reacting, clock, sweeps } = stepped;
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [watching] });
    await definitionRecorded(store, {
      name: 'tick',
      version: 1,
      triggers: [cronTrigger('5 9 * * *'), everyTrigger(10 * aMinute)],
    });
    await definitionRecorded(store, {
      name: 'tick',
      version: 2,
      triggers: [everyTrigger(10 * aMinute)],
      when: isoAt(1),
    });
    await untilTriggersAt(sweeps, reacting.database, 'tick', 2);

    clock.moveTo(activatedAt + 10 * aMinute);
    await startsReaching(sweeps, reacting.reactions.starts, 1);
    const starts = await sentinelPassed(stepped, 2);

    expect(starts.map(({ workflow, version, trigger }) => [workflow, version, trigger.kind])).toEqual([
      ['tick', 2, 'every'],
      ['watch', 1, 'event'],
    ]);
  });
});

describe('a version without a schedule, and a retirement', () => {
  it('stop every trigger of the workflow', async () => {
    const stepped = await steppedReacting();
    const { reacting, clock, sweeps } = stepped;
    const { store } = reacting.database;
    const closed = eventTrigger({ type: 'com.acme.closed' });
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [watching] });
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed, everyTrigger(aMinute)] });
    await definitionRecorded(store, { name: 'open', version: 1, triggers: [closed, cronTrigger('5 9 * * *')] });
    await definitionRecorded(store, { name: 'close', version: 2, triggers: [] });
    await definitionRetired(store, 'open', 1);
    await sweeps.until(
      () => triggerRowsOf(reacting.database),
      (rows) => rows.map(({ workflow }) => workflow).join() === 'watch',
      fewSweeps,
    );

    clock.moveTo(activatedAt + 10 * aMinute);
    await published(store, { id: 'closed', type: 'com.acme.closed' });
    const starts = await sentinelPassed(stepped, 1);

    expect(starts.map(({ workflow }) => workflow)).toEqual(['watch']);
    expect((await triggerRowsOf(reacting.database)).map(({ workflow }) => workflow)).toEqual(['watch']);
  });
});

describe('the changes a version makes to the triggers of the version before', () => {
  it('keep a trigger whose filters name the same attributes in another order', () => {
    const before = eventTrigger({ type: 'com.acme.closed', data: { region: 'eu', team: 'ledger' } });
    const after = eventTrigger({ data: { team: 'ledger', region: 'eu' }, type: 'com.acme.closed' });

    expect(triggerChangesOf([before], [after])).toEqual([{ change: 'kept', trigger: after }]);
  });

  it('activate a cron schedule whose time zone changed, and keep one whose time zone did not', () => {
    const inLondon = cronTrigger('0 9 * * *', { time_zone: 'Europe/London' });
    const inNewYork = cronTrigger('0 9 * * *', { time_zone: 'America/New_York' });

    expect([triggerChangesOf([inLondon], [inNewYork]), triggerChangesOf([inLondon], [inLondon])]).toEqual([
      [{ change: 'activated', trigger: inNewYork }],
      [{ change: 'kept', trigger: inLondon }],
    ]);
  });

  it('activate a changed or added trigger, and remove a trigger the version leaves out', () => {
    const cron = cronTrigger('0 9 * * *');

    expect(
      triggerChangesOf([everyTrigger(60_000), cron], [everyTrigger(120_000), eventTrigger({ type: 'go' })]),
    ).toEqual([
      { change: 'activated', trigger: everyTrigger(120_000) },
      { change: 'activated', trigger: eventTrigger({ type: 'go' }) },
      { change: 'removed', reference: '/schedule/cron' },
    ]);
  });
});

describe('the triggers of a playbook made again from the records of its definitions', () => {
  it('are the rows the follower kept as it passed the same records one by one', async () => {
    const live = await steppedReacting();
    await definitionsOfThePlaybook(live.reacting.database.store);
    await untilTriggersAt(live.sweeps, live.reacting.database, 'tick', 2);
    const settings = await aLedgerInMemory();
    await definitionsOfThePlaybook((await openedOn(settings)).store);

    const rebuilt = await steppedReacting({ settings });
    await untilTriggersAt(rebuilt.sweeps, rebuilt.reacting.database, 'tick', 2);
    const rows = await triggerRowsOf(rebuilt.reacting.database);

    expect(rows).toEqual(await triggerRowsOf(live.reacting.database));
    expect(
      rows.map(({ workflow, reference, version, activated_by: by }) => [workflow, reference, version, by]),
    ).toEqual([
      ['close', '/schedule/every', 3, definitionRecordAt('close', 1)],
      ['close', '/schedule/on', 3, definitionRecordAt('close', 3)],
      ['tick', '/schedule/every', 2, definitionRecordAt('tick', 2)],
    ]);
  });
});

describe('the triggers of a playbook made again, past the records of its definitions that cannot be read', () => {
  it('pass over a record that cannot be read, which is said', async () => {
    const settings = await aLedgerInMemory();
    const { store } = await openedOn(settings);
    await playbookCreated(store, 'alpha');
    const broken = { ...byAdmin, definitionType: 'workflow', definitionName: 'broken', definitionVersion: 1 };
    await definitionRecorded(store, { name: 'broken', version: 1, triggers: [] });
    await recorded(
      store,
      definitionStreamNamed('broken'),
      { type: 'definition_updated', data: { content: 7 } },
      { ...broken, definitionVersion: 2 },
    );
    await recorded(
      store,
      definitionStreamNamed('broken'),
      { type: 'definition_updated', data: { content: {} } },
      { ...broken, definitionVersion: 3 },
    );
    await definitionRecorded(store, { name: 'tick', version: 1, triggers: [everyTrigger(aMinute)] });

    const { reacting, sweeps } = await steppedReacting({ settings });
    await untilTriggersAt(sweeps, reacting.database, 'tick', 1);
    const notes = await sweeps.until(
      () => reacting.notes(),
      (found) => found.length >= 2,
      fewSweeps,
    );

    expect(notes).toEqual([
      {
        kind: 'record_unreadable',
        org: 'acme',
        playbook: 'alpha',
        recordId: definitionRecordAt('broken', 2),
        type: 'definition_updated',
      },
      {
        kind: 'record_unreadable',
        org: 'acme',
        playbook: 'alpha',
        recordId: definitionRecordAt('broken', 3),
        type: 'definition_updated',
      },
    ]);
  });
});

describe('a retirement and a restoration of a workflow with triggers', () => {
  it('bring the rows of its triggers back paused, a schedule with no next due time until a resumption sets its first time after it', async () => {
    const { database, applied } = await applying();
    const triggers = [eventTrigger({ type: 'com.acme.closed' }), everyTrigger(15 * aMinute)];
    await applied(saved({ id: 's1', name: 'close', version: 1, triggers }), retired('r1', 'close'));
    const whileRetired = [await rowsIn(database), await pausesOf(database)];

    await applied(restored('b1', 'close', triggers, restoredAt));
    const onceRestored = [await rowsIn(database), await pausesOf(database)];
    await applied(resumed('u1', 'close', resumedAt));

    expect(whileRetired).toEqual([[], []]);
    expect(onceRestored).toEqual([
      [
        row({ reference: '/schedule/every', version: 1, kind: 'every', by: 'b1', at: restoredAt, due: null }),
        row({ reference: '/schedule/on', version: 1, kind: 'event', by: 'b1', at: restoredAt, due: null }),
      ],
      ['close'],
    ]);
    expect([await rowsIn(database), await pausesOf(database)]).toEqual([
      [
        row({
          reference: '/schedule/every',
          version: 1,
          kind: 'every',
          by: 'b1',
          at: restoredAt,
          due: restoredAt + 15 * aMinute,
        }),
        row({ reference: '/schedule/on', version: 1, kind: 'event', by: 'b1', at: restoredAt, due: null }),
      ],
      [],
    ]);
  });
});
