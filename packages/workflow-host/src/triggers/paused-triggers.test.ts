import { describe, expect, it } from 'vitest';

import {
  pausesOf,
  refusalsOf,
  startsReaching,
  triggerRowsOf,
  untilPaused,
  untilTriggersAt,
} from '../reaction-testing/kept-triggers.ts';
import { movedClock } from '../reaction-testing/moved-clock.ts';
import {
  at,
  definitionPaused,
  definitionRecorded,
  definitionResumed,
  definitionRetired,
  eventRecordOf,
  eventTrigger,
  everyTrigger,
  published,
} from '../reaction-testing/playbook-writes.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';

const activatedAt = Date.parse(at);

const aMinute = 60_000;

function isoAt(minutes: number): string {
  return new Date(activatedAt + minutes * aMinute).toISOString();
}

async function tickingBesideAWitness() {
  const clock = movedClock(activatedAt + 1000);
  const reacting = await reactingHost({ clock });
  const { store } = reacting.database;
  await definitionRecorded(store, { name: 'tick', version: 1, triggers: [everyTrigger(aMinute)] });
  await definitionRecorded(store, { name: 'witness', version: 1, triggers: [everyTrigger(aMinute)] });
  await untilTriggersAt(reacting.database, 'witness', 1);
  const startsOf = (workflow: string) => reacting.reactions.starts().filter((start) => start.workflow === workflow);
  const witnessed = async (count: number) => {
    await startsReaching(() => startsOf('witness'), count);
    return startsOf('tick');
  };
  return { reacting, clock, store, startsOf, witnessed };
}

describe('a paused workflow with a schedule', () => {
  it('starts nothing at a due time that came before its pause was swept, as the record of the pause says it was paused after it', async () => {
    const { reacting, clock, store, witnessed } = await tickingBesideAWitness();
    await definitionPaused(store, { name: 'tick', version: 1, when: isoAt(1.2) });
    await untilPaused(reacting.database, ['tick']);

    clock.moveTo(activatedAt + 1.5 * aMinute);

    expect(await witnessed(1)).toEqual([]);
  });

  it('starts nothing at the times due while it is paused, and once resumed starts at the first time after, making up none it missed', async () => {
    const { reacting, clock, store, startsOf, witnessed } = await tickingBesideAWitness();
    clock.moveTo(activatedAt + aMinute);
    const [beforeThePause] = await witnessed(1);
    await definitionPaused(store, { name: 'tick', version: 1, when: isoAt(1.5) });
    await untilPaused(reacting.database, ['tick']);
    clock.moveTo(activatedAt + 2 * aMinute);
    const whilePaused = await witnessed(2);
    clock.moveTo(activatedAt + 3 * aMinute);
    const stillPaused = await witnessed(3);

    await definitionResumed(store, { name: 'tick', version: 1, when: isoAt(3.5) });
    await untilPaused(reacting.database, []);
    clock.moveTo(activatedAt + 4 * aMinute);
    const resumed = await startsReaching(() => startsOf('tick'), 2);

    expect([beforeThePause?.input, whilePaused.length, stillPaused.length]).toEqual([
      { schedule: { due: isoAt(1) } },
      1,
      1,
    ]);
    expect(resumed.map(({ input }) => input)).toEqual([
      { schedule: { due: isoAt(1) } },
      { schedule: { due: isoAt(4) } },
    ]);
    expect((await refusalsOf(reacting.database)).filter(({ workflow }) => workflow === 'tick')).toEqual([]);
  });
});

describe('a paused workflow with a schedule saved anew', () => {
  it('keeps a version saved while it is paused waiting, and once resumed starts that version at its first time after', async () => {
    const { reacting, clock, store, startsOf, witnessed } = await tickingBesideAWitness();
    await definitionPaused(store, { name: 'tick', version: 1, when: isoAt(0.5) });
    await definitionRecorded(store, {
      name: 'tick',
      version: 2,
      triggers: [everyTrigger(2 * aMinute)],
      when: isoAt(0.6),
    });
    await untilTriggersAt(reacting.database, 'tick', 2);
    clock.moveTo(activatedAt + 2.6 * aMinute);
    const whilePaused = await witnessed(1);

    await definitionResumed(store, { name: 'tick', version: 2, when: isoAt(3) });
    await untilPaused(reacting.database, []);
    clock.moveTo(activatedAt + 4.6 * aMinute);
    const resumed = await startsReaching(() => startsOf('tick'), 1);

    expect(whilePaused).toEqual([]);
    expect(resumed.map(({ version, input }) => [version, input])).toEqual([[2, { schedule: { due: isoAt(4.6) } }]]);
  });

  it('forgets its pause when it is retired, as it forgets its triggers', async () => {
    const { reacting, store } = await tickingBesideAWitness();
    await definitionPaused(store, { name: 'tick', version: 1, when: isoAt(0.5) });
    await untilPaused(reacting.database, ['tick']);

    await definitionRetired(store, 'tick', 1);
    await untilPaused(reacting.database, []);

    expect([
      await pausesOf(reacting.database),
      (await triggerRowsOf(reacting.database)).map(({ workflow }) => workflow),
    ]).toEqual([[], ['witness']]);
  });
});

describe('a paused workflow with an event trigger', () => {
  it('starts nothing for an event recorded while it is paused, and once resumed replays none of them', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    const watching = eventTrigger({ type: 'com.acme.sentinel' });
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [watching] });
    await definitionRecorded(store, { name: 'witness', version: 1, triggers: [watching] });
    await definitionPaused(store, { name: 'watch', version: 1, when: at });
    await untilPaused(reacting.database, ['watch']);
    await published(store, { id: 'while-paused', type: 'com.acme.sentinel' });
    await startsReaching(reacting.reactions.starts, 1);

    await definitionResumed(store, { name: 'watch', version: 1, when: at });
    await untilPaused(reacting.database, []);
    await published(store, { id: 'once-resumed', type: 'com.acme.sentinel' });
    const starts = await startsReaching(reacting.reactions.starts, 3);

    expect(starts.map(({ workflow, cause }) => [workflow, cause])).toEqual([
      ['witness', eventRecordOf('while-paused')],
      ['watch', eventRecordOf('once-resumed')],
      ['witness', eventRecordOf('once-resumed')],
    ]);
  });
});
