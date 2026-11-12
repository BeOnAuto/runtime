import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import {
  firstDestination as destination,
  intoAQueue,
  ofEachSubscription,
  ofTheApp,
  overASocket,
  sentBy,
  without,
} from '../testing/event-destinations.ts';
import { tracker } from '../testing/fixture-providers.ts';

const ofASocket = 'a websocket destination takes open, credential, connection, acknowledge, and heartbeat_seconds';

describe('the events part of an entry', () => {
  it('is taken whole for a service that sends by webhook, by socket or into a queue, in the order to try them', () => {
    expect([
      sentBy(ofEachSubscription, overASocket, intoAQueue),
      sentBy(ofTheApp),
      sentBy({ ...overASocket, open: { url: 'wss://events.chat.example.com/socket?app=auto' } }),
      problemsOf(tracker),
    ]).toEqual([[], [], [], []]);
  });

  it('names one destination at least, of each type once', () => {
    expect(sentBy()).toMatchObject([['/events/destinations', expect.any(String)]]);
    expect(sentBy(ofEachSubscription, ofTheApp)).toEqual([
      [
        '/events/destinations/1/type',
        'Expected a type no earlier destination has, since an entry takes one destination of each type, in the order to try them',
      ],
    ]);
  });

  it('refuses a type, a way of arranging and a queue it does not know', () => {
    expect(sentBy({ ...ofTheApp, type: 'email' })).toMatchObject([[`${destination}/type`, expect.any(String)]]);
    expect(sentBy({ ...ofTheApp, per: 'person' })).toMatchObject([[`${destination}/per`, expect.any(String)]]);
    expect(sentBy({ ...intoAQueue, kind: 'kafka' })).toMatchObject([[`${destination}/kind`, expect.any(String)]]);
  });
});

describe('the fields of a destination', () => {
  it('are those of its type and of how it is arranged, which a webhook and a queue say', () => {
    expect(sentBy(without(ofEachSubscription, 'subscribe', 'unsubscribe'))).toEqual([
      [`${destination}/subscribe`, 'Expected subscribe, which a webhook destination per subscription takes'],
      [`${destination}/unsubscribe`, 'Expected unsubscribe, which a webhook destination per subscription takes'],
    ]);
    expect(sentBy(without(ofEachSubscription, 'per'))).toEqual([
      [`${destination}/per`, 'Expected per, which a webhook destination takes: subscription or app'],
    ]);
  });

  it('are no others', () => {
    expect(sentBy({ ...without(ofTheApp, 'connection'), topic: '{{ with.project }}' })).toEqual([
      [
        `${destination}/topic`,
        'Expected no topic: a webhook destination per app takes verify, connection, and handshake',
      ],
      [`${destination}/connection`, 'Expected connection, which a webhook destination per app takes'],
    ]);
    expect(sentBy({ ...overASocket, per: 'app', kind: 'azure-event-hubs' })).toEqual([
      [`${destination}/per`, `Expected no per: ${ofASocket}`],
      [`${destination}/kind`, `Expected no kind: ${ofASocket}`],
    ]);
  });

  it('of a queue of the app are where an arrival names whose connection it is, and the queue', () => {
    expect(sentBy({ ...intoAQueue, verify: ofEachSubscription.verify, per: 'app' })).toMatchObject([
      [`${destination}/topic`, 'Expected no topic: a queue destination per app takes kind and connection'],
      [`${destination}/subscribe`, expect.stringContaining('Expected no subscribe')],
      [`${destination}/renew`, expect.stringContaining('Expected no renew')],
      [`${destination}/unsubscribe`, expect.stringContaining('Expected no unsubscribe')],
      [`${destination}/lease_seconds`, expect.stringContaining('Expected no lease_seconds')],
      [`${destination}/verify`, expect.stringContaining('Expected no verify')],
      [`${destination}/connection`, 'Expected connection, which a queue destination per app takes'],
      [`${destination}/wake/subscription`, expect.stringContaining('Expected subscription only')],
      [`${destination}/verify/secret`, expect.stringContaining('Expected app')],
    ]);
  });
});

describe('a destination of the app', () => {
  it("is proven by the app's own secret", () => {
    expect(sentBy({ ...ofTheApp, verify: { ...ofTheApp.verify, secret: 'subscription' } })).toEqual([
      [
        `${destination}/verify/secret`,
        "Expected app: a destination per app proves its deliveries with the app's own secret",
      ],
    ]);
  });
});
