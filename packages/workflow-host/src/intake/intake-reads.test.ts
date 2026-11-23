import type { ReportedEvent } from '@on.auto/definitions/connection-events';
import { readTopicOf, type TriggerRead } from '@on.auto/definitions/trigger-reads';
import { describe, expect, it } from 'vitest';

import { recordedIn } from '../intake-testing/taken-rows.ts';
import { anIntake, arrivalOf, servedListingNoEvents, servedWithTopics, source } from '../intake-testing/taking-in.ts';

const opened = 'com.example.ticket.opened';

const ticket: ReportedEvent = { type: opened, id: 'T-1', time: '2026-11-20T08:59:00Z', data: { title: 'A ticket' } };

const nothingTaken = (reason: string) => ({ outcome: 'not_taken', reasons: [reason] });

const listingTickets: TriggerRead = {
  tool: 'list_tickets',
  with: { after: '{{ since }}' },
  list: '/tickets',
  order: 'oldest_first',
  id: ['/id'],
};

const listingClosed: TriggerRead = { ...listingTickets, with: { after: '{{ since }}', state: 'closed' } };

const fromTheTickets = { type: opened, source };

describe('an item a read of a trigger listed, through a connection that declares no events', () => {
  it('is taken only by the trigger whose read listed it, and by no other trigger of the same type', async () => {
    const { workflows, takenIn } = await anIntake(servedListingNoEvents);
    await workflows.savedReading('opened', fromTheTickets, listingTickets);

    const answers = [
      await takenIn(arrivalOf(ticket, readTopicOf(opened, listingTickets))),
      await takenIn(arrivalOf({ ...ticket, id: 'T-2' }, readTopicOf(opened, listingClosed))),
      await takenIn(arrivalOf({ ...ticket, id: 'T-3' })),
    ];

    expect(answers).toEqual([{ outcome: 'taken' }, nothingTaken('no_trigger'), nothingTaken('no_trigger')]);
  });

  it('is never taken by a trigger with a read through a connection that declares its events', async () => {
    const { workflows, takenIn } = await anIntake(servedWithTopics('board-7'));
    await workflows.savedReading('opened', fromTheTickets, listingTickets);

    expect(await takenIn(arrivalOf(ticket))).toEqual(nothingTaken('no_trigger'));
  });
});

describe('items of two lists through one connection whose id values are the same', () => {
  it('are each recorded under their own type, and an item read again is recorded once', async () => {
    const commented = 'com.example.ticket.commented';
    const listingComments: TriggerRead = { ...listingTickets, tool: 'list_comments', list: '/comments' };
    const { database, workflows, takenIn } = await anIntake(servedListingNoEvents);
    await workflows.savedReading('opened', fromTheTickets, listingTickets);
    await workflows.savedReading('commented', { type: commented, source }, listingComments);
    const listedTicket = arrivalOf({ ...ticket, id: `${opened}/42` }, readTopicOf(opened, listingTickets));
    const listedComment = arrivalOf(
      { ...ticket, type: commented, id: `${commented}/42` },
      readTopicOf(commented, listingComments),
    );

    await takenIn(listedTicket);
    await takenIn(listedComment);
    await takenIn(listedTicket);

    expect((await recordedIn(database)).map((recorded) => recorded?.data.event.id)).toEqual(
      expect.arrayContaining([`${commented}/42`, `${opened}/42`]),
    );
    expect(await recordedIn(database)).toHaveLength(2);
  });
});
