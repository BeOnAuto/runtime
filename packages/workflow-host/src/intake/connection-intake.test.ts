import type { ReportedEvent } from '@on.auto/definitions/connection-events';
import { ledgerLayout } from '@on.auto/ledger';
import { playbookCallerOf } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { hostLayoutSteps } from '../database/host-layout-steps.ts';
import { counted, holdsAnywhere, outcomesIn, paused, recordedIn } from '../intake-testing/taken-rows.ts';
import { anIntake, arrivalOf, servedWithTopics, source, takenAt } from '../intake-testing/taking-in.ts';
import { subscribed } from '../reaction-testing/event-subscriptions.ts';
import { stopsByItsMemory } from '../reaction-testing/trigger-starting.ts';

const opened = 'com.example.ticket.opened';

const marker = 'a-title-no-table-may-hold';

const ticket: ReportedEvent = {
  type: opened,
  id: 'T-1',
  time: '2026-11-20T08:59:00Z',
  subject: 'board-7',
  data: { title: marker },
};

const onTheBoard = { type: opened, source, subject: 'board-7' };

const nothingTaken = (reason: string) => ({ outcome: 'not_taken', reasons: [reason] });

describe('an event of a connection a trigger names', () => {
  it('is recorded once, as the playbook, and a repeat records nothing', async () => {
    const { database, takenIn } = await anIntake();
    await subscribed(database, 'triage', onTheBoard);
    const repeat = { ...ticket, data: { title: 'later' } };

    expect([await takenIn(arrivalOf(ticket)), await takenIn(arrivalOf(repeat))]).toEqual([
      { outcome: 'taken' },
      { outcome: 'taken' },
    ]);
    expect(await recordedIn(database)).toEqual([
      {
        type: 'event_published',
        data: { event: { specversion: '1.0', ...ticket, source }, filled: [] },
        context: { at: new Date(takenAt).toISOString(), by: playbookCallerOf({ org: 'acme', playbook: 'alpha' }).id },
      },
    ]);
    expect(await outcomesIn(database)).toEqual([]);
  });

  it('is recorded once when two deliveries of it arrive at once', async () => {
    const { database, takenIn } = await anIntake();
    await subscribed(database, 'triage', onTheBoard);

    await Promise.all([takenIn(arrivalOf(ticket)), takenIn(arrivalOf(ticket))]);

    expect(await recordedIn(database)).toHaveLength(1);
  });

  it('is taken through the filters of a sandbox, as the compositions give them', async () => {
    const { database, takenInASandbox } = await anIntake();
    await subscribed(database, 'triage', onTheBoard);

    expect(await takenInASandbox(arrivalOf(ticket))).toEqual({ outcome: 'taken' });
  });
});

describe('an event a made-up entry maps to another shape', () => {
  it('goes through unchanged: a two-part id, no subject, its data, its time filled as it is recorded', async () => {
    const { database, takenIn } = await anIntake();
    const type = 'com.example.row.changed';
    await subscribed(database, 'any', { type, source });
    const row = {
      type,
      id: 'sheet%2F4/17',
      data: {
        cells: [
          [1, 'a'],
          [2, null],
        ],
      },
    };

    expect(await takenIn(arrivalOf(row))).toEqual({ outcome: 'taken' });
    expect((await recordedIn(database)).map((recorded) => recorded?.data)).toEqual([
      { event: { specversion: '1.0', ...row, source, time: new Date(takenAt).toISOString() }, filled: ['time'] },
    ]);
  });
});

describe('an event a filter is stopped on by its deadline or its memory', () => {
  it('is recorded, since the filter may match it, and the follower judges it', async () => {
    const { database, takenIn } = await anIntake();
    await subscribed(database, 'busy', { ...onTheBoard, data: stopsByItsMemory });

    expect(await takenIn(arrivalOf(ticket))).toEqual({ outcome: 'taken' });
    expect(await recordedIn(database)).toHaveLength(1);
  });
});

describe('an event of a connection the triggers that name it do not take', () => {
  it('is counted by the reason of each such trigger, and nothing of it is written', async () => {
    const { database, takenIn } = await anIntake();
    await subscribed(database, 'elsewhere', { ...onTheBoard, subject: 'board-9' });
    await subscribed(database, 'broken', { ...onTheBoard, data: '${ $data.a.b }' });
    await subscribed(database, 'others', { type: opened, source: '/connections/another' });

    expect(await takenIn(arrivalOf(ticket))).toEqual({ outcome: 'not_taken', reasons: ['filtered', 'filter_failed'] });
    expect(await outcomesIn(database)).toEqual([counted('broken', 'filter_failed'), counted('elsewhere', 'filtered')]);
    expect([await recordedIn(database), await holdsAnywhere(database, marker)]).toEqual([[], false]);
  });

  it('is counted as not asked for where an app or a bot did it and the trigger names no such events', async () => {
    const { database, takenIn } = await anIntake();
    await subscribed(database, 'people', onTheBoard);
    const byABot = { ...ticket, automatic: true };

    const before = await takenIn(arrivalOf(byABot));
    await subscribed(database, 'bots', { ...onTheBoard, automatic: true });

    expect([before, await takenIn(arrivalOf(byABot))]).toEqual([
      nothingTaken('automatic_not_asked'),
      { outcome: 'taken' },
    ]);
    expect(await outcomesIn(database)).toEqual([counted('people', 'automatic_not_asked')]);
  });

  it('is judged by every trigger of its type, however many pages of them the playbook holds', async () => {
    const { database, takenIn } = await anIntake();
    const names = Array.from({ length: 101 }, (_, index) => `elsewhere-${index}`);
    await names.reduce<Promise<void>>(
      (before, name) => before.then(() => subscribed(database, name, { ...onTheBoard, subject: 'board-9' })),
      Promise.resolve(),
    );

    expect(await takenIn(arrivalOf(ticket))).toEqual(nothingTaken('filtered'));
    expect(await outcomesIn(database)).toHaveLength(names.length);
  });
});

describe('an event of a connection no active trigger names', () => {
  it('is counted once before any trigger, a paused trigger among those that name none, and nothing of it is written', async () => {
    const { database, takenIn } = await anIntake();
    await subscribed(database, 'resting', onTheBoard);
    await paused(database, 'resting');

    const answers = [await takenIn(arrivalOf(ticket)), await takenIn(arrivalOf(ticket))];

    expect(answers).toEqual([nothingTaken('no_trigger'), nothingTaken('no_trigger')]);
    expect(await outcomesIn(database)).toEqual([counted('', 'no_trigger', 2)]);
    expect([await recordedIn(database), await holdsAnywhere(database, marker)]).toEqual([[], false]);
  });

  it('is counted twice when two intakes count it at once', async () => {
    const { database, takenIn } = await anIntake();

    await Promise.all([takenIn(arrivalOf(ticket)), takenIn(arrivalOf(ticket))]);

    expect(await outcomesIn(database)).toEqual([counted('', 'no_trigger', 2)]);
  });
});

describe('an event the intake cannot take whatever its triggers say', () => {
  it('is not taken where its topic is not the one of the subscription it was delivered under', async () => {
    const { database, takenIn } = await anIntake(servedWithTopics('board-7'));
    await subscribed(database, 'triage', onTheBoard);

    const answers = [await takenIn(arrivalOf(ticket, 'board-9')), await takenIn(arrivalOf(ticket, 'board-7'))];

    expect(answers).toEqual([nothingTaken('topic_mismatch'), { outcome: 'taken' }]);
    expect(await outcomesIn(database)).toEqual([counted('', 'topic_mismatch')]);
  });

  it('is not taken where the playbook cannot record it as an event, and nothing of it is written', async () => {
    const { database, takenIn } = await anIntake();
    await subscribed(database, 'triage', onTheBoard);

    expect(await takenIn(arrivalOf({ ...ticket, id: 'x'.repeat(257) }))).toEqual(nothingTaken('invalid_event'));
    expect([await outcomesIn(database), await holdsAnywhere(database, marker)]).toEqual([
      [counted('', 'invalid_event')],
      false,
    ]);
  });

  it('is refused where the connection does not serve the playbook, and nothing is written', async () => {
    const { database, takenIn } = await anIntake('not served');
    await subscribed(database, 'triage', onTheBoard);

    expect(await takenIn(arrivalOf(ticket))).toEqual({ outcome: 'refused' });
    expect([await recordedIn(database), await outcomesIn(database), await holdsAnywhere(database, marker)]).toEqual([
      [],
      [],
      false,
    ]);
  });
});

describe('the layout the table of the outcomes takes', () => {
  it('is one step that makes nothing, the host making the table empty as it opens', async () => {
    const { database } = await anIntake();

    expect(hostLayoutSteps).toEqual([{ layout: ledgerLayout, statements: [] }]);
    expect(await outcomesIn(database)).toEqual([]);
  });
});
