import type { Trigger } from '@on.auto/definitions';
import type { LedgerStreams } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import {
  pausesOf,
  startsReaching,
  triggerRowsOf,
  untilPaused,
  untilTriggersAt,
} from '../reaction-testing/kept-triggers.ts';
import {
  at,
  byAdmin,
  cronTrigger,
  definitionRecorded,
  definitionStreamNamed,
  definitionResumed,
  eventRecordOf,
  eventTrigger,
  everyTrigger,
  published,
  recorded,
} from '../reaction-testing/playbook-writes.ts';
import { keptDefinition, steppedReacting } from '../reaction-testing/stepped-reactions.ts';
import { fewSweeps } from '../testing/stepped-clock.ts';

const createdAt = Date.parse(at);

const aMinute = 60_000;

function isoAt(minutes: number): string {
  return new Date(createdAt + minutes * aMinute).toISOString();
}

function createdPaused(store: LedgerStreams, name: string, triggers: readonly Trigger[]) {
  return recorded(
    store,
    definitionStreamNamed(name),
    {
      type: 'definition_created',
      data: {
        content: { source: 'schedule: {}', triggers },
        playbook: 'alpha',
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        paused: { reason: 'Imported, waiting for its owner' },
      },
    },
    { ...byAdmin, definitionType: 'workflow', definitionName: name, definitionVersion: 1 },
  );
}

async function scheduledBesideAWitness(trigger: Trigger) {
  const stepped = await steppedReacting();
  const { reacting, clock, sweeps } = stepped;
  const { store } = reacting.database;
  await createdPaused(store, 'imported', [trigger]);
  await keptDefinition(stepped, { name: 'witness', version: 1, triggers: [everyTrigger(aMinute)] });
  await untilPaused(sweeps, reacting.database, ['imported']);
  const startsOf = (workflow: string) => reacting.reactions.starts().filter((start) => start.workflow === workflow);
  const witnessed = async (count: number) => {
    await startsReaching(sweeps, () => startsOf('witness'), count);
    return startsOf('imported');
  };
  return { reacting, clock, sweeps, store, startsOf, witnessed };
}

describe('a workflow created paused with an every schedule', () => {
  it('has its trigger kept with no next due time from the moment it is created, and starts nothing at the times due', async () => {
    const { reacting, clock, sweeps, witnessed } = await scheduledBesideAWitness(everyTrigger(aMinute));
    const rows = await untilTriggersAt(sweeps, reacting.database, 'imported', 1);
    clock.moveTo(createdAt + aMinute);
    const atTheFirst = await witnessed(1);
    clock.moveTo(createdAt + 2 * aMinute);

    expect(rows.filter(({ workflow }) => workflow === 'imported').map(({ next_due }) => next_due)).toEqual([null]);
    expect([atTheFirst, await witnessed(2)]).toEqual([[], []]);
  });

  it('once resumed starts at its first time due after the resumption, as any resumed workflow, making up none it missed', async () => {
    const { reacting, clock, sweeps, store, startsOf, witnessed } = await scheduledBesideAWitness(
      everyTrigger(aMinute),
    );
    clock.moveTo(createdAt + aMinute);
    const atTheFirst = await witnessed(1);
    clock.moveTo(createdAt + 2 * aMinute);
    const whilePaused = [...atTheFirst, ...(await witnessed(2))];

    await definitionResumed(store, { name: 'imported', version: 1, when: isoAt(2.5) });
    await untilPaused(sweeps, reacting.database, []);
    clock.moveTo(createdAt + 3 * aMinute);
    const resumed = await startsReaching(sweeps, () => startsOf('imported'), 1);

    expect(whilePaused).toEqual([]);
    expect(resumed.map(({ input }) => input)).toEqual([{ schedule: { due: isoAt(3) } }]);
  });
});

describe('a workflow created paused, its source saved again while it is paused', () => {
  it('starts nothing at the times its new version names until it is resumed', async () => {
    const { reacting, clock, sweeps, store, startsOf, witnessed } = await scheduledBesideAWitness(
      everyTrigger(aMinute),
    );
    await definitionRecorded(store, {
      name: 'imported',
      version: 2,
      triggers: [everyTrigger(aMinute)],
      when: isoAt(0.5),
    });
    const rows = await sweeps.until(
      async () => (await triggerRowsOf(reacting.database)).filter(({ workflow }) => workflow === 'imported'),
      (kept: readonly { readonly version: number }[]) => kept.map(({ version }) => version).join() === '2',
      fewSweeps,
    );
    clock.moveTo(createdAt + aMinute);
    const atTheFirst = await witnessed(1);
    clock.moveTo(createdAt + 2 * aMinute);
    const whilePaused = [...atTheFirst, ...(await witnessed(2))];

    await definitionResumed(store, { name: 'imported', version: 2, when: isoAt(2.5) });
    await untilPaused(sweeps, reacting.database, []);
    clock.moveTo(createdAt + 3 * aMinute);
    const resumed = await startsReaching(sweeps, () => startsOf('imported'), 1);

    expect(rows.map(({ version, next_due }) => [version, next_due])).toEqual([[2, null]]);
    expect(whilePaused).toEqual([]);
    expect(resumed.map(({ version, input }) => [version, input])).toEqual([[2, { schedule: { due: isoAt(3) } }]]);
  });
});

describe('a workflow created paused with a cron schedule', () => {
  it('starts nothing at the minutes due until it is resumed, and then at the first minute after', async () => {
    const { reacting, clock, sweeps, store, startsOf, witnessed } = await scheduledBesideAWitness(
      cronTrigger('* * * * *'),
    );
    clock.moveTo(createdAt + aMinute);
    const atTheFirst = await witnessed(1);
    clock.moveTo(createdAt + 2 * aMinute);
    const whilePaused = [...atTheFirst, ...(await witnessed(2))];

    await definitionResumed(store, { name: 'imported', version: 1, when: isoAt(2.5) });
    await untilPaused(sweeps, reacting.database, []);
    clock.moveTo(createdAt + 3 * aMinute);
    const resumed = await startsReaching(sweeps, () => startsOf('imported'), 1);

    expect(whilePaused).toEqual([]);
    expect(resumed.map(({ input }) => input)).toEqual([{ schedule: { due: isoAt(3) } }]);
  });
});

describe('a workflow created paused with an event trigger', () => {
  it('starts nothing for an event recorded before it is resumed, and once resumed starts for the next one alone', async () => {
    const { reacting, sweeps } = await steppedReacting();
    const { store } = reacting.database;
    const watching = eventTrigger({ type: 'com.acme.sentinel' });
    await createdPaused(store, 'imported', [watching]);
    await definitionRecorded(store, { name: 'witness', version: 1, triggers: [watching] });
    await untilPaused(sweeps, reacting.database, ['imported']);
    await published(store, { id: 'while-paused', type: 'com.acme.sentinel' });
    await startsReaching(sweeps, reacting.reactions.starts, 1);

    await definitionResumed(store, { name: 'imported', version: 1, when: at });
    await untilPaused(sweeps, reacting.database, []);
    await published(store, { id: 'once-resumed', type: 'com.acme.sentinel' });
    const starts = await startsReaching(sweeps, reacting.reactions.starts, 3);

    expect(await pausesOf(reacting.database)).toEqual([]);
    const [first, ...ofTheResumed] = starts.map(({ workflow, cause }) => [workflow, cause]);
    expect([
      first,
      ofTheResumed.toSorted((one: readonly string[], other: readonly string[]) =>
        String(one).localeCompare(String(other)),
      ),
    ]).toEqual([
      ['witness', eventRecordOf('while-paused')],
      [
        ['imported', eventRecordOf('once-resumed')],
        ['witness', eventRecordOf('once-resumed')],
      ],
    ]);
  });
});
