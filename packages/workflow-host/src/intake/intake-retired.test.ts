import type { ReportedEvent } from '@on.auto/definitions/connection-events';
import { savedTriggersOf } from '@on.auto/definitions/connection-triggers';
import { PlaybookRegistry } from '@on.auto/operations';
import { Cause, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { holdsAnywhere, outcomesIn, recordedIn } from '../intake-testing/taken-rows.ts';
import { anIntake, arrivalOf, servedWithTopics, source } from '../intake-testing/taking-in.ts';

const marker = 'a-title-no-table-may-hold';

const ticket: ReportedEvent = {
  type: 'com.example.ticket.opened',
  id: 'T-1',
  subject: 'board-7',
  data: { title: marker },
};

const onTheBoard = { type: ticket.type, source, subject: 'board-7' };

const notTakenWhileRetired = { outcome: 'not_taken', reasons: ['playbook_retired'] };

const unreadable = PlaybookRegistry.of({ status: () => Effect.die(new Error('The registry did not answer')) });

describe('an event of a connection for a retired playbook', () => {
  it('is not taken, whatever its topic, and nothing of it is recorded, counted or kept, though an active workflow names the connection', async () => {
    const { database, workflows, playbook, takenIn } = await anIntake(servedWithTopics('board-7'));
    await workflows.saved('triage', onTheBoard);
    await playbook.retired();

    const answers = [await takenIn(arrivalOf(ticket, 'board-7')), await takenIn(arrivalOf(ticket, 'board-9'))];

    expect(answers).toEqual([notTakenWhileRetired, notTakenWhileRetired]);
    expect([await recordedIn(database), await outcomesIn(database), await holdsAnywhere(database, marker)]).toEqual([
      [],
      [],
      false,
    ]);
  });

  it('is refused, as for any playbook, where the connection does not serve it', async () => {
    const { workflows, playbook, takenIn } = await anIntake('not served');
    await workflows.saved('triage', onTheBoard);
    await playbook.retired();

    expect(await takenIn(arrivalOf(ticket))).toEqual({ outcome: 'refused' });
  });

  it('is taken from the next event once the playbook is restored, and one that arrived while it was retired never is', async () => {
    const { database, workflows, playbook, takenIn } = await anIntake();
    await workflows.saved('triage', onTheBoard);
    await playbook.retired();
    const whileRetired = await takenIn(arrivalOf(ticket));
    await playbook.restored();

    const next = await takenIn(arrivalOf({ ...ticket, id: 'T-2' }));

    expect([whileRetired, next]).toEqual([notTakenWhileRetired, { outcome: 'taken' }]);
    expect((await recordedIn(database)).map((recorded) => recorded?.data.event.id)).toEqual(['T-2']);
  });

  it('fails, so its caller tries again, where the status of the playbook cannot be read, and nothing is written', async () => {
    const { database, workflows, failureOf } = await anIntake(servedWithTopics(), savedTriggersOf, () => unreadable);
    await workflows.saved('triage', onTheBoard);

    expect(Cause.hasDies(await failureOf(arrivalOf(ticket)))).toBe(true);
    expect([await recordedIn(database), await outcomesIn(database)]).toEqual([[], []]);
  });
});
