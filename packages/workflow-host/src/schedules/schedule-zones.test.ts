import { describe, expect, it } from 'vitest';

import { refusalsSaid, runStillGoing, startsReaching, triggerRowsOf } from '../reaction-testing/kept-triggers.ts';
import {
  cronTrigger,
  definitionKeyNamed,
  definitionRecorded,
  eventTrigger,
  everyTrigger,
  published,
} from '../reaction-testing/playbook-writes.ts';
import type { ReactingHost } from '../reaction-testing/reacting-host.ts';
import { keptDefinition, steppedReacting, type SteppedReacting } from '../reaction-testing/stepped-reactions.ts';
import { reactionRunIdOf } from '../reactions/reaction-ids.ts';
import { fewSweeps } from '../testing/stepped-clock.ts';

type InNewYork = SteppedReacting;

const savedAt = '2026-03-06T12:00:00.000Z';

async function inNewYork(saved = savedAt): Promise<InNewYork> {
  const zoned = await steppedReacting({ startsAt: Date.parse(saved) + 1000 });
  await keptDefinition(zoned, {
    name: 'morning',
    version: 1,
    triggers: [cronTrigger('0 6 * * *', { time_zone: 'America/New_York' })],
    when: saved,
  });
  return zoned;
}

function startedAtEach({ reacting, clock, sweeps }: InNewYork, dueTimes: readonly string[]) {
  return dueTimes.reduce<Promise<ReturnType<ReactingHost['reactions']['starts']>>>(async (before, due, index) => {
    await before;
    clock.moveTo(Date.parse(due));
    return startsReaching(sweeps, reacting.reactions.starts, index + 1);
  }, Promise.resolve([]));
}

const changes: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  [
    'spring',
    '2026-03-06T12:00:00.000Z',
    ['2026-03-07T11:00:00.000Z', '2026-03-08T10:00:00.000Z', '2026-03-09T10:00:00.000Z'],
  ],
  [
    'autumn',
    '2026-10-30T12:00:00.000Z',
    ['2026-10-31T10:00:00.000Z', '2026-11-01T11:00:00.000Z', '2026-11-02T11:00:00.000Z'],
  ],
];

describe('a workflow with a cron schedule in a time zone', () => {
  it.each(changes)(
    'is started once a day at the hour its clocks show, across the %s change',
    async (_change, saved, dueTimes) => {
      const starts = await startedAtEach(await inNewYork(saved), dueTimes);

      expect(starts.map(({ input }) => input)).toEqual(dueTimes.map((due) => ({ schedule: { due } })));
    },
  );

  it('says its time zone when a due time is skipped while the run before still runs', async () => {
    const zoned = await inNewYork();
    await startedAtEach(zoned, ['2026-03-07T11:00:00.000Z']);
    await runStillGoing(
      zoned.reacting.database,
      reactionRunIdOf(definitionKeyNamed('morning'), 1, '/schedule/cron', '2026-03-07T11:00:00.000Z'),
    );

    zoned.clock.moveTo(Date.parse('2026-03-08T10:00:00.000Z'));

    expect(await refusalsSaid(zoned.sweeps, zoned.reacting.database)).toEqual([
      {
        workflow: 'morning',
        reason:
          'The run scheduled for 2026-03-08T10:00:00.000Z by its cron schedule in America/New_York was skipped: the run it started before is still running',
      },
    ]);
  });
});

async function aRoundWithSchedulesThatCannotBeComputed() {
  const { reacting, clock, sweeps } = await inNewYork();
  const { database } = reacting;
  const misread = cronTrigger('61 2 * * *');
  await definitionRecorded(database.store, { name: 'misread', version: 1, triggers: [misread], when: savedAt });
  const tick = { name: 'tick', version: 1, triggers: [everyTrigger(60_000)], when: '2026-03-07T10:59:00.000Z' };
  await definitionRecorded(database.store, tick);
  await definitionRecorded(database.store, { name: 'close', version: 1, triggers: [eventTrigger({ type: 'closed' })] });
  clock.forgetZone('America/New_York');

  clock.moveTo(Date.parse('2026-03-07T11:00:00.000Z'));
  await published(database.store, { id: 'closed-1', type: 'closed' });
  const started = await startsReaching(sweeps, reacting.reactions.starts, 2);
  const refused = await refusalsSaid(sweeps, database, 2);
  const rows = await sweeps.until(
    () => triggerRowsOf(database),
    (found) => found.filter(({ next_due: nextDue }) => nextDue === null).length >= 3,
    fewSweeps,
  );
  return {
    started: started.map(({ workflow }) => workflow).toSorted(),
    refused: refused.toSorted((first, second) => first.workflow.localeCompare(second.workflow)),
    nextDues: rows.map(({ workflow, next_due: nextDue }) => [workflow, nextDue]),
    notes: reacting
      .notes()
      .filter((note) => note.kind === 'schedule_stopped')
      .toSorted((first, second) => first.workflow.localeCompare(second.workflow)),
  };
}

function stoppedNote(workflow: string, detail: string) {
  return {
    kind: 'schedule_stopped',
    org: 'acme',
    playbook: 'alpha',
    workflow,
    version: 1,
    reference: '/schedule/cron',
    detail,
  };
}

describe('a schedule whose times cannot be computed', () => {
  it('is refused on its own and said in a line naming its definition, while other schedules and deliveries go on', async () => {
    const round = await aRoundWithSchedulesThatCannotBeComputed();

    expect(round).toEqual({
      started: ['close', 'tick'],
      refused: [
        {
          workflow: 'misread',
          reason:
            'The times of its cron schedule in UTC cannot be computed, so it starts no more runs: CronPattern: Invalid value for minute: 61',
        },
        {
          workflow: 'morning',
          reason:
            'The times of its cron schedule in America/New_York cannot be computed, so it starts no more runs: Invalid time zone specified: America/New_York',
        },
      ],
      nextDues: [
        ['close', null],
        ['misread', null],
        ['morning', null],
        ['tick', Date.parse('2026-03-07T11:01:00.000Z')],
      ],
      notes: [
        stoppedNote('misread', 'CronPattern: Invalid value for minute: 61'),
        stoppedNote('morning', 'Invalid time zone specified: America/New_York'),
      ],
    });
  });
});
