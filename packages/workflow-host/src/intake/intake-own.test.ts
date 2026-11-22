import type { ReportedEvent } from '@on.auto/definitions/connection-events';
import { playbookCallerOf } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { counted, holdsAnywhere, outcomesIn, recordedIn } from '../intake-testing/taken-rows.ts';
import { anIntake, arrivalOf, servedActingAs, servedWithTopics, source, takenAt } from '../intake-testing/taking-in.ts';

const opened = 'com.example.ticket.opened';

const marker = 'a-title-no-table-may-hold';

const itsAccount = 'member-account-of-the-connection';

const ticket: ReportedEvent = {
  type: opened,
  id: 'T-1',
  time: '2026-11-20T08:59:00Z',
  subject: 'board-7',
  data: { title: marker },
};

const byItsAccount: ReportedEvent = { ...ticket, actor: itsAccount };

const bySomeoneElse: ReportedEvent = { ...ticket, id: 'T-2', actor: 'member-account-of-someone-else' };

const onTheBoard = { type: opened, source, subject: 'board-7' };

const taken = { outcome: 'taken' };

const nothingTaken = (...reasons: readonly string[]) => ({ outcome: 'not_taken', reasons });

const asThePlaybook = {
  at: new Date(takenAt).toISOString(),
  by: playbookCallerOf({ org: 'acme', playbook: 'alpha' }).id,
};

describe('an event the connection’s own account caused', () => {
  it('starts nothing where no trigger asks for it: it is counted as not asked for, and nothing of it is written', async () => {
    const { database, workflows, takenIn } = await anIntake(servedActingAs(itsAccount));
    await workflows.saved('triage', onTheBoard);

    expect(await takenIn(arrivalOf(byItsAccount))).toEqual(nothingTaken('own_not_asked'));
    expect(await outcomesIn(database)).toEqual([counted('triage', 'own_not_asked')]);
    expect([await recordedIn(database), await holdsAnywhere(database, marker)]).toEqual([[], false]);
    expect(await holdsAnywhere(database, itsAccount)).toBe(false);
  });

  it('is taken once, marked own, by a trigger whose filter writes own: true, and its actor is written nowhere', async () => {
    const { database, workflows, takenIn } = await anIntake(servedActingAs(itsAccount));
    await workflows.saved('triage', onTheBoard);
    await workflows.saved('mine', { ...onTheBoard, own: true });
    const repeat = { ...byItsAccount, data: { title: 'later' } };

    expect([await takenIn(arrivalOf(byItsAccount)), await takenIn(arrivalOf(repeat))]).toEqual([taken, taken]);
    expect(await recordedIn(database)).toEqual([
      {
        type: 'event_published',
        data: { event: { specversion: '1.0', ...ticket, source, own: true }, filled: [] },
        context: asThePlaybook,
      },
    ]);
    expect([await outcomesIn(database), await holdsAnywhere(database, itsAccount)]).toEqual([[], false]);
  });
});

describe('an event another account caused, through a connection that knows the account it acts as', () => {
  it('is taken as any event is, unmarked, and a trigger that asks for own events alone filters it out', async () => {
    const { database, workflows, takenIn } = await anIntake(servedActingAs(itsAccount));
    await workflows.saved('mine', { ...onTheBoard, own: true });

    const before = await takenIn(arrivalOf(bySomeoneElse));
    await workflows.saved('triage', onTheBoard);

    expect([before, await takenIn(arrivalOf(bySomeoneElse))]).toEqual([nothingTaken('filtered'), taken]);
    expect((await recordedIn(database)).map((recorded) => recorded?.data.event)).toEqual([
      { specversion: '1.0', ...ticket, id: 'T-2', source },
    ]);
    expect(await holdsAnywhere(database, 'member-account-of-someone-else')).toBe(false);
  });

  it('is taken as before where the event names nobody, whether or not the connection knows its account', async () => {
    const known = await anIntake(servedActingAs(itsAccount));
    const unknown = await anIntake(servedWithTopics());
    await known.workflows.saved('triage', onTheBoard);
    await unknown.workflows.saved('triage', onTheBoard);

    expect([await known.takenIn(arrivalOf(ticket)), await unknown.takenIn(arrivalOf(ticket))]).toEqual([taken, taken]);
  });
});

describe('an event that names who caused it, through a connection that holds no account it acts as yet', () => {
  it('is not taken, since whether it is the connection’s own cannot be told: it is counted for each trigger that names the connection, and nothing of it is written', async () => {
    const { database, workflows, takenIn } = await anIntake(servedWithTopics());
    await workflows.saved('triage', onTheBoard);
    await workflows.saved('mine', { ...onTheBoard, own: true });

    expect(await takenIn(arrivalOf(bySomeoneElse))).toEqual(nothingTaken('connection_unidentified'));
    expect(await outcomesIn(database)).toEqual([
      counted('mine', 'connection_unidentified'),
      counted('triage', 'connection_unidentified'),
    ]);
    expect([await recordedIn(database), await holdsAnywhere(database, marker)]).toEqual([[], false]);
  });

  it('is counted as no trigger where none names the connection', async () => {
    const { database, takenIn } = await anIntake(servedWithTopics());

    expect(await takenIn(arrivalOf(byItsAccount))).toEqual(nothingTaken('no_trigger'));
    expect(await outcomesIn(database)).toEqual([counted('', 'no_trigger')]);
  });
});

describe('an event an app or a bot made, through the connection’s own account', () => {
  it('is taken only by a filter that writes both automatic: true and own: true, and counted by the mark each other trigger leaves out', async () => {
    const { database, workflows, takenIn } = await anIntake(servedActingAs(itsAccount));
    await workflows.saved('people', onTheBoard);
    await workflows.saved('bots', { ...onTheBoard, automatic: true });
    await workflows.saved('mine', { ...onTheBoard, own: true });
    const itsOwnBot = { ...byItsAccount, automatic: true };

    const before = await takenIn(arrivalOf(itsOwnBot));
    await workflows.saved('both', { ...onTheBoard, automatic: true, own: true });

    expect([before, await takenIn(arrivalOf(itsOwnBot))]).toEqual([
      nothingTaken('automatic_not_asked', 'own_not_asked'),
      taken,
    ]);
    expect(await outcomesIn(database)).toEqual([
      counted('mine', 'automatic_not_asked'),
      counted('bots', 'own_not_asked'),
      counted('people', 'own_not_asked'),
    ]);
  });
});

describe('an event a made-up entry maps to another shape, whose account is a whole number', () => {
  it('is the connection’s own only where its actor is the recorded account’s id as the same text', async () => {
    const { database, workflows, takenIn } = await anIntake(servedActingAs('7'));
    const type = 'com.example.row.changed';
    await workflows.saved('any', { type, source });
    const row = { type, id: 'sheet%2F4/17', data: { cells: [[1, 'a']] } };

    const answers = [
      await takenIn(arrivalOf({ ...row, actor: '7' })),
      await takenIn(arrivalOf({ ...row, id: 'sheet%2F4/18', actor: '07' })),
    ];

    expect(answers).toEqual([nothingTaken('own_not_asked'), taken]);
    expect((await recordedIn(database)).map((recorded) => recorded?.data.event.id)).toEqual(['sheet%2F4/18']);
  });
});
