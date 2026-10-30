import { messageIdOf } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import {
  refusalsSaid,
  runEnded,
  runStillGoing,
  startsReaching,
  triggerRowsOf,
  untilTriggersAt,
} from '../reaction-testing/kept-triggers.ts';
import { movedClock } from '../reaction-testing/moved-clock.ts';
import {
  alpha,
  at,
  cronTrigger,
  eventTrigger,
  everyTrigger,
  published,
  definitionRecordAt,
  definitionRecorded,
  definitionRetired,
} from '../reaction-testing/playbook-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';

const activatedAt = Date.parse(at);

const aMinute = 60_000;

const watching = eventTrigger({ type: 'com.acme.sentinel' });

function isoAt(minutes: number): string {
  return new Date(activatedAt + minutes * aMinute).toISOString();
}

async function tickingEveryMinute() {
  const clock = movedClock(activatedAt + 1000);
  const reacting = await reactingHost({ clock });
  await definitionRecorded(reacting.database.store, { name: 'tick', version: 1, triggers: [everyTrigger(aMinute)] });
  clock.moveTo(activatedAt + aMinute);
  const [first] = await startsReaching(reacting.reactions.starts, 1);
  await runStillGoing(reacting.database, first?.runId ?? '');
  return { reacting, clock, running: first?.runId ?? '' };
}

async function sentinelPassed(reacting: ReactingHost, count: number) {
  await published(reacting.database.store, { id: 'sentinel', type: 'com.acme.sentinel' });
  return startsReaching(reacting.reactions.starts, count);
}

describe('a version that leaves the triggers of the one before unchanged', () => {
  it('keeps their anchor, their next due time and their running run, and the next run is of the new version', async () => {
    const { reacting, clock, running } = await tickingEveryMinute();
    const { database } = reacting;
    await definitionRecorded(database.store, {
      name: 'tick',
      version: 2,
      triggers: [everyTrigger(aMinute)],
      when: isoAt(1.5),
    });
    await untilTriggersAt(database, 'tick', 2);

    clock.moveTo(activatedAt + 2 * aMinute);
    const refusals = await refusalsSaid(database);
    await runEnded(database, running);
    clock.moveTo(activatedAt + 3 * aMinute);
    const [, next] = await startsReaching(reacting.reactions.starts, 2);

    expect(refusals.map(({ reason }) => reason)).toEqual([
      `The run its every schedule had due at ${isoAt(2)} was skipped: the run its every schedule started before still runs`,
    ]);
    expect([next?.version, next?.input, next?.cause]).toEqual([
      2,
      { schedule: { due: isoAt(3) } },
      definitionRecordAt(1),
    ]);
  });
});

describe('a version that changes an every schedule', () => {
  it('counts it from its own record, and skips while a run the version before started still runs', async () => {
    const { reacting, clock, running } = await tickingEveryMinute();
    const { database } = reacting;
    await definitionRecorded(database.store, {
      name: 'tick',
      version: 2,
      triggers: [everyTrigger(2 * aMinute)],
      when: isoAt(1.5),
    });
    await untilTriggersAt(database, 'tick', 2);

    clock.moveTo(activatedAt + 3.5 * aMinute);
    const refusals = await refusalsSaid(database);
    await runEnded(database, running);
    clock.moveTo(activatedAt + 5.5 * aMinute);
    const [, next] = await startsReaching(reacting.reactions.starts, 2);

    expect(refusals.map(({ reason }) => reason)).toEqual([
      `The run its every schedule had due at ${isoAt(3.5)} was skipped: the run its every schedule started before still runs`,
    ]);
    expect([next?.version, next?.input, next?.cause]).toEqual([
      2,
      { schedule: { due: isoAt(5.5) } },
      definitionRecordAt(2),
    ]);
  });
});

describe('a version that changes the event trigger', () => {
  it('matches nothing recorded before it, while what matched before it starts the version before', async () => {
    const reacting = await reactingHost();
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

    const starts = await sentinelPassed(reacting, 3);

    expect(starts.map(({ workflow, version, cause }) => [workflow, version, cause])).toEqual([
      ['close', 1, messageIdOf(`${alpha}events/closed-before`, 1)],
      ['close', 2, messageIdOf(`${alpha}events/opened-after`, 1)],
      ['watch', 1, messageIdOf(`${alpha}events/sentinel`, 1)],
    ]);
  });
});

describe('a version that removes a cron schedule', () => {
  it('fires it no more, while its every schedule goes on', async () => {
    const clock = movedClock(activatedAt + 1000);
    const reacting = await reactingHost({ clock });
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
    await untilTriggersAt(reacting.database, 'tick', 2);

    clock.moveTo(activatedAt + 10 * aMinute);
    await startsReaching(reacting.reactions.starts, 1);
    const starts = await sentinelPassed(reacting, 2);

    expect(starts.map(({ workflow, version, trigger }) => [workflow, version, trigger.kind])).toEqual([
      ['tick', 2, 'every'],
      ['watch', 1, 'event'],
    ]);
  });
});

describe('a version without a schedule, and a retirement', () => {
  it('stop every trigger of the workflow', async () => {
    const clock = movedClock(activatedAt + 1000);
    const reacting = await reactingHost({ clock });
    const { store } = reacting.database;
    const closed = eventTrigger({ type: 'com.acme.closed' });
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [watching] });
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed, everyTrigger(aMinute)] });
    await definitionRecorded(store, { name: 'open', version: 1, triggers: [closed, cronTrigger('5 9 * * *')] });
    await definitionRecorded(store, { name: 'close', version: 2, triggers: [] });
    await definitionRetired(store, 'open', 1);

    clock.moveTo(activatedAt + 10 * aMinute);
    await published(store, { id: 'closed', type: 'com.acme.closed' });
    const starts = await sentinelPassed(reacting, 1);

    expect(starts.map(({ workflow }) => workflow)).toEqual(['watch']);
    expect((await triggerRowsOf(reacting.database)).map(({ workflow }) => workflow)).toEqual(['watch']);
  });
});
