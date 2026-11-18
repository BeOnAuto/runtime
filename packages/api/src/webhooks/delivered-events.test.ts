import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import {
  eventsPath,
  eventsServedWith,
  nowSeconds,
  roomHeaders,
  roomsSecret,
  ticketHeaders,
  ticketsSecret,
} from '../testing/delivered-events.ts';
import { deliveryBounds } from './delivery-bounds.ts';
import { deliveryProblems } from './delivery-problems.ts';

type Handler = ReturnType<typeof eventsServedWith>['handler'];

const commentBody = { comment: { thread: 'thread-42', text: 'Looks right to me' } };

const comment = JSON.stringify(commentBody);

const postedBody = { kind: 'message_posted', workspace: 'W-9', message: { room: 'room-5', text: 'Ship it' } };

const posted = JSON.stringify(postedBody);

function delivered(handler: Handler, connection: string, body: string, headers: Readonly<Record<string, string>>) {
  return call(handler, eventsPath(connection), { method: 'POST', headers, body });
}

function ticket(handler: Handler, headers = ticketHeaders(comment)) {
  return delivered(handler, 'tickets', comment, headers);
}

function room(handler: Handler, headers = roomHeaders(posted)) {
  return delivered(handler, 'rooms', posted, headers);
}

const ticketsAddress = { org: 'acme', playbook: 'ops', connection: 'tickets' };

describe('a delivery its connection’s service proves', () => {
  it('is handed to arrived with its reading, its arrival and what its proof covers, and answered an empty 200', async () => {
    const { handler, served } = eventsServedWith();
    const theTrackersHeaders: unknown = expect.objectContaining({ 'x-tracker-hook': 'hook-7' });
    const theRoomsBody: unknown = expect.objectContaining({ body: postedBody });

    const answers = [await ticket(handler), await room(handler)];

    expect(answers.map(({ status, text }) => `${status} ${text}`)).toEqual(['200 ', '200 ']);
    expect(served.arrived).toEqual([
      {
        address: ticketsAddress,
        reading: { wake: { subscription: 'hook-7', conversation: 'thread-42' } },
        arrival: { transport: 'request', headers: theTrackersHeaders, query: {}, body: commentBody },
        provesTheBodyAndATime: false,
      },
      {
        address: { ...ticketsAddress, connection: 'rooms' },
        reading: { wake: { conversation: 'room-5' }, connection: { account: 'W-9' } },
        arrival: theRoomsBody,
        provesTheBodyAndATime: true,
      },
    ]);
    expect(served.heard.map(({ outcome, status }) => `${outcome} ${status}`)).toEqual(['arrived 200', 'arrived 200']);
    expect(served.asked).toEqual([
      'destination of tickets',
      'secrets of tickets by subscription',
      'destination of rooms',
      'secrets of rooms by app',
    ]);
  });

  it('is handed on each time it is sent, since the consumer is the one that knows what a repeat means', async () => {
    const { handler, served } = eventsServedWith();

    await ticket(handler);
    await ticket(handler);

    expect(served.arrived).toHaveLength(2);
  });
});

describe('a proven delivery whose reading holds nothing', () => {
  it('is answered an empty 200 and handed nowhere', async () => {
    const { handler, served } = eventsServedWith();

    const answer = await ticket(handler, ticketHeaders(comment, { event: 'label' }));

    expect(`${answer.status} ${answer.text}`).toBe('200 ');
    expect(served.arrived).toEqual([]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['passed_over']);
  });

  it('is read without a body where its body is no JSON or no UTF-8 text, its proof over the bytes as sent', async () => {
    const { handler, served } = eventsServedWith();
    const bytes = Uint8Array.from([0x7b, 0xff, 0x7d]);

    const answers = [
      await delivered(handler, 'tickets', 'thread-42', ticketHeaders('thread-42')),
      await handler.fetch(
        new Request(`http://localhost${eventsPath('tickets')}`, {
          method: 'POST',
          headers: ticketHeaders(bytes),
          body: bytes,
        }),
      ),
    ];

    expect(answers.map(({ status }) => status)).toEqual([200, 200]);
    expect(served.arrived.map(({ reading, arrival }) => [reading, 'body' in arrival])).toEqual([
      [{ wake: { subscription: 'hook-7' } }, false],
      [{ wake: { subscription: 'hook-7' } }, false],
    ]);
  });
});

describe('the steps before anything is read', () => {
  it('refuse a body past 256 KiB before the destination is asked, as it declares itself or as it arrives', async () => {
    const { handler, served } = eventsServedWith();
    const large = 'a'.repeat(256 * 1024 + 1);

    const answers = [
      await ticket(handler, { ...ticketHeaders(comment), 'content-length': String(large.length) }),
      await delivered(handler, 'tickets', large, ticketHeaders(large)),
    ];

    expect(answers.map(({ status }) => status)).toEqual([413, 413]);
    expect(served.asked).toEqual([]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['unread', 'unread']);
  });

  it('refuse past the deliveries of a minute at an address before its body is read, each one counted', async () => {
    const bounds = { ...deliveryBounds, deliveriesOfAConnectionAMinute: 2 };
    const { handler, served } = eventsServedWith({ bounds });

    const answers = [
      await ticket(handler, ticketHeaders(comment, { secret: roomsSecret })),
      await ticket(handler),
      await ticket(handler),
      await room(handler),
    ];

    expect(answers.map(({ status }) => status)).toEqual([401, 200, 429, 200]);
    expect(answers[2]?.headers.get('retry-after')).toBe('60');
    expect(answers[2]?.body).toMatchObject({ reason: 'too_many_requests' });
    expect(served.asked.filter((asked) => asked.startsWith('destination'))).toHaveLength(3);
  });
});

describe('the steps that read', () => {
  it('ask for no secret where there is no destination, or where the delivery presents no proof', async () => {
    const { handler, served } = eventsServedWith();
    const { 'x-tracker-signature': _, ...unsigned } = ticketHeaders(comment);

    await delivered(handler, 'billing', comment, ticketHeaders(comment));
    await ticket(handler, unsigned);

    expect(served.asked).toEqual(['destination of billing', 'destination of tickets']);
  });
});

describe('a delivery that is not proven', () => {
  it('is answered the one refusal of the answer address, byte for byte, whatever failed, no secret yet among them', async () => {
    const { handler, served } = eventsServedWith();
    const { 'x-tracker-signature': _, ...unsigned } = ticketHeaders(comment);
    const refusal = `401 ${await deliveryProblems.unsigned().text()}`;

    const answers = [
      await call(handler, eventsPath('tickets').replace('/acme/', '/Acme Corp/'), { method: 'POST', body: comment }),
      await delivered(handler, 'c'.repeat(257), comment, ticketHeaders(comment)),
      await delivered(handler, 'billing', comment, ticketHeaders(comment)),
      await ticket(handler, unsigned),
      await ticket(handler, { ...ticketHeaders(comment), 'x-tracker-signature': 'sha256=zz' }),
      await room(handler, roomHeaders(posted, { timestamp: nowSeconds - 301 })),
      await ticket(handler, ticketHeaders(comment, { secret: roomsSecret })),
      await delivered(handler, 'drafts', comment, ticketHeaders(comment)),
    ];

    expect(new Set(answers.map(({ status, text }) => `${status} ${text}`))).toEqual(new Set([refusal]));
    expect(served.arrived).toEqual([]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual([
      'malformed',
      'malformed',
      'unknown',
      'unsigned',
      'unsigned',
      'stale',
      'mismatched',
      'mismatched',
    ]);
  });
});

const sentAndNeverTold = [ticketsSecret, roomsSecret, 'hook-7', 'delivery-31', 'thread-42', 'room-5', 'W-9', 'Ship it'];

describe('what the door tells of a delivery', () => {
  it('is its address, its outcome, its status and its size, never a secret, a header or the body', async () => {
    const { handler, served } = eventsServedWith();

    await ticket(handler);
    await ticket(handler, ticketHeaders(comment, { secret: roomsSecret }));
    await room(handler);
    const told = JSON.stringify(served.heard);

    expect(served.heard[0]).toEqual({
      address: ticketsAddress,
      outcome: 'arrived',
      status: 200,
      bytes: comment.length,
    });
    expect(sentAndNeverTold.filter((sent) => told.includes(sent))).toEqual([]);
  });
});

describe('a consumer that fails', () => {
  it('fails the delivery as any request that throws, so the service sends it again, and nothing sent is reported', async () => {
    const { handler, served, reported } = eventsServedWith({
      arrived: () => Promise.reject(new Error('The playbook could not be woken')),
    });

    const answer = await room(handler);
    const report = JSON.stringify(reported.map(({ message, call: summary }) => ({ message, summary })));

    expect(answer.status).toBe(500);
    expect(reported).toHaveLength(1);
    expect(served.heard).toEqual([]);
    expect(sentAndNeverTold.filter((sent) => report.includes(sent))).toEqual([]);
  });
});
