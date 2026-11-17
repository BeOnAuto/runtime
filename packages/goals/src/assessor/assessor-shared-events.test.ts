import { describe, expect, it } from 'vitest';

import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { deliveredAll, monday } from './assessor-ledger.ts';
import { gaveUp, hour, inboxBook, logged, orderId, type Inbox } from './inbox-samples.ts';

const twoEmails: Inbox = {
  emails: [
    ['juniper', monday - 1000],
    ['harbor', monday - 1000],
  ],
  runs: [
    ['run-log-1', 'juniper', monday - 900],
    ['run-log-2', 'harbor', monday - 900],
    ['run-decide-1', 'juniper', monday - 900],
    ['run-count-1', 'juniper', monday - 900],
  ],
};

describe('a failed run of a workflow that contributes to the goal, started by the email that started the run that marked a thing', () => {
  it('stops that thing with its own words, though neither run is in the other’s chain, and no thing another email brought', async () => {
    const { book, assessor } = await inboxBook(twoEmails);
    await deliveredAll(assessor, logged('log-1', 'ORD-1'));
    await deliveredAll(assessor, logged('log-2', 'ORD-2'));

    const delivered = await deliveredAll(assessor, gaveUp('decide-1', 'decide-order'));
    const rows = await book.rows(assessmentsName);

    expect(delivered.keys).toEqual([`s:${orderId('ORD-1')}`]);
    expect(rows[orderId('ORD-1')]).toMatchObject({
      open: true,
      verdict: 'open',
      stopped_run: 'run-decide-1',
      stopped_at: monday + 20 * hour,
    });
    expect(String(rows[orderId('ORD-1')]?.['state'])).toContain('No decision within 20 hours, so no reply was sent.');
    expect(rows[orderId('ORD-2')]).toMatchObject({ open: true, stopped_at: null });
  });
});

describe('a failed run started by the same email that stops nothing', () => {
  it('is one of a workflow that contributes only to another goal', async () => {
    const { book, assessor } = await inboxBook(twoEmails);
    await deliveredAll(assessor, logged('log-1', 'ORD-1'));

    const delivered = await deliveredAll(assessor, gaveUp('count-1', 'count-mail'));

    expect(delivered.keys).toEqual([]);
    expect((await book.rows(assessmentsName))[orderId('ORD-1')]).toMatchObject({ stopped_at: null });
  });

  it('is one that ended before the thing was marked, or after a mark made before the email arrived', async () => {
    const early: Inbox = {
      emails: [['juniper', monday + hour]],
      runs: [
        ['run-log-1', 'juniper', monday - 900],
        ['run-log-2', 'juniper', monday + 3 * hour],
        ['run-decide-1', 'juniper', monday + hour],
      ],
    };
    const { book, assessor } = await inboxBook(early);
    await deliveredAll(assessor, logged('log-1', 'ORD-1'));
    await deliveredAll(assessor, logged('log-2', 'ORD-2', monday + 3 * hour));

    const delivered = await deliveredAll(assessor, gaveUp('decide-1', 'decide-order', monday + 2 * hour));

    expect(delivered.keys).toEqual([]);
    expect(Object.values(await book.rows(assessmentsName)).map((row) => row['stopped_at'])).toEqual([null, null]);
  });
});
