import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { boardHeaders, boardsHook, tokenHeaders } from '../testing/carried-events.ts';
import {
  eventsPath,
  eventsServedWith,
  heldSecret,
  neighboursHook,
  neighboursSecret,
  roomsSecret,
  ticketHeaders,
  ticketsHook,
  ticketsSecret,
} from '../testing/delivered-events.ts';

type Handler = ReturnType<typeof eventsServedWith>['handler'];

const openedBody = { action: 'opened', ticket: { id: 'T-81', project: 'project-3', title: 'The export is empty' } };

const opened = JSON.stringify(openedBody);

const theOpenedTicket = {
  type: 'com.example.tracker.ticket.opened',
  id: 'T-81',
  subject: 'project-3',
  data: { title: 'The export is empty' },
};

const movedBody = {
  kind: 'card_moved',
  board: { slug: 'roadmap' },
  card: { key: 'C-9', labels: ['urgent', 'q4'] },
  move: { seq: 4, to: 'Done', at: 1_794_318_000, by_app: 'sorter' },
};

const moved = JSON.stringify(movedBody);

function delivered(handler: Handler, connection: string, body: string, headers: Readonly<Record<string, string>>) {
  return call(handler, eventsPath(connection), { method: 'POST', headers, body });
}

function ticketOpened(handler: Handler, headers = ticketHeaders(opened, { event: 'opened' })) {
  return delivered(handler, 'tickets', opened, headers);
}

describe('a proven delivery that carries an event its connection’s entry maps', () => {
  it('is handed on once with the event its reading holds and the topic of the subscription whose own secret proves it', async () => {
    const { handler, served } = eventsServedWith();

    const answer = await ticketOpened(handler);

    expect(`${answer.status} ${answer.text}`).toBe('200 ');
    expect(served.arrived.map(({ reading, carried }) => ({ reading, carried }))).toEqual([
      { reading: { event: theOpenedTicket }, carried: { event: theOpenedTicket, topic: ticketsHook.topic } },
    ]);
  });

  it('of another shape is handed on as its entry maps it, its two-part id, its time, its data and that an app did it', async () => {
    const { handler, served } = eventsServedWith();

    await delivered(handler, 'boards', moved, boardHeaders(moved));

    expect(served.arrived.map(({ carried }) => carried)).toEqual([
      {
        event: {
          type: 'org.example.boards.card.moved',
          id: 'C-9/4',
          time: '2026-11-10T13:40:00Z',
          subject: 'roadmap',
          data: { lane: 'Done', labels: ['urgent', 'q4'] },
          automatic: true,
        },
        topic: boardsHook.topic,
      },
    ]);
  });
});

describe('a proven delivery that carries an event, sent again or beside a wake', () => {
  it('sent again is handed on again, since the intake is the one that records a repeat as nothing', async () => {
    const { handler, served } = eventsServedWith();

    await ticketOpened(handler);
    await ticketOpened(handler);

    expect(served.arrived.map(({ carried }) => carried?.event.id)).toEqual(['T-81', 'T-81']);
  });

  it('that also wakes a reply’s reading is handed on with its wake as before, and its event beside it', async () => {
    const { handler, served } = eventsServedWith();
    const both = JSON.stringify({ ...openedBody, comment: { thread: 'thread-42' } });

    await delivered(handler, 'tickets', both, ticketHeaders(both));

    expect(served.arrived.map(({ reading, carried }) => ({ wake: reading.wake, carried }))).toEqual([
      {
        wake: { subscription: 'hook-7', conversation: 'thread-42' },
        carried: { event: theOpenedTicket, topic: ticketsHook.topic },
      },
    ]);
  });
});

describe('a delivery that carries an event its connection’s entry maps, where nothing ties it to its own subscription', () => {
  it('is never handed on unproven, signed with a secret no subscription of its connection holds', async () => {
    const { handler, served } = eventsServedWith();

    const answers = [
      await ticketOpened(handler, ticketHeaders(opened, { secret: roomsSecret, event: 'opened' })),
      await delivered(handler, 'boards', moved, boardHeaders(moved, ticketsSecret)),
    ];

    expect(answers.map(({ status }) => status)).toEqual([401, 401]);
    expect(served.arrived).toEqual([]);
  });

  it('proven by a neighbour’s own secret, whatever it names, is handed on with the neighbour’s topic alone, for the intake to hold the event to it', async () => {
    const { handler, served } = eventsServedWith();

    await ticketOpened(handler, ticketHeaders(opened, { secret: neighboursSecret, hook: '', event: 'opened' }));
    await ticketOpened(handler, ticketHeaders(opened, { secret: neighboursSecret, hook: 'hook-7', event: 'opened' }));

    expect(served.arrived.map(({ carried }) => carried?.topic)).toEqual([neighboursHook.topic, neighboursHook.topic]);
  });

  it('proven by a secret held for two subscriptions and naming neither is handed on with no event', async () => {
    const heldTwice = [heldSecret(ticketsSecret, ticketsHook), heldSecret(ticketsSecret, neighboursHook)];
    const { handler, served } = eventsServedWith({ secrets: () => Promise.resolve(heldTwice) });

    await ticketOpened(handler, ticketHeaders(opened, { hook: '', event: 'opened' }));

    expect(served.arrived.map(({ reading, carried }) => [reading.event?.id, carried])).toEqual([['T-81', undefined]]);
  });

  it('proven by a token in a header, which proves who sent it and not its body, is handed on with no event', async () => {
    const { handler, served } = eventsServedWith();

    const answer = await delivered(handler, 'tokens', moved, tokenHeaders());

    expect(answer.status).toBe(200);
    expect(served.arrived.map(({ reading, carried }) => [reading.event?.id, carried])).toEqual([['C-9/4', undefined]]);
  });
});
