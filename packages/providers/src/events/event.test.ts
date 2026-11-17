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

function provenBy(verify: unknown) {
  return problemsOf({ ...tracker, events: { destinations: [{ ...ofTheApp, verify }] } });
}

const verify = '/events/destinations/0/verify';

const hmac = {
  scheme: 'hmac',
  secret: 'app',
  hash: 'sha256',
  signed_payload: '{id}.{timestamp}.{payload}',
  signature: '$request.header.X-Signature',
  encoding: 'base64',
  timestamp: '$request.body#/sent_at',
  id: '$request.header.X-Delivery',
};

describe('the proof of a delivery', () => {
  it('is a keyed hash, a delivery signed as Standard Webhooks signs one, a secret in a header or a signed token', () => {
    expect([
      provenBy(hmac),
      provenBy({ scheme: 'standard-webhooks', secret: 'app' }),
      provenBy({ scheme: 'bearer', secret: 'app', token: '$request.header.Authorization', prefix: 'Bearer ' }),
      provenBy({ scheme: 'jwt', secret: 'app', token: '$request.header.Authorization', prefix: 'JWT ', alg: 'HS256' }),
    ]).toEqual([[], [], [], []]);
  });
});

describe('the fields of a proof', () => {
  it('are those of its scheme and no other', () => {
    expect(provenBy({ scheme: 'standard-webhooks', secret: 'app', hash: 'sha256' })).toEqual([
      [
        `${verify}/hash`,
        'Expected no hash: the standard-webhooks proof takes nothing but its secret, since the specification fixes the rest',
      ],
    ]);
    expect(provenBy({ scheme: 'jwt', secret: 'app', token: '$request.header.Authorization', encoding: 'hex' })).toEqual(
      [
        [`${verify}/encoding`, 'Expected no encoding: the jwt proof takes token, alg, and prefix'],
        [`${verify}/alg`, 'Expected alg, which the jwt proof takes'],
      ],
    );
    expect(provenBy({ scheme: 'hmac', secret: 'app' })).toEqual([
      [`${verify}/hash`, 'Expected hash, which the hmac proof takes'],
      [`${verify}/signed_payload`, 'Expected signed_payload, which the hmac proof takes'],
      [`${verify}/signature`, 'Expected signature, which the hmac proof takes'],
      [`${verify}/encoding`, 'Expected encoding, which the hmac proof takes'],
    ]);
  });

  it('refuses a hash, an encoding or an algorithm it does not take', () => {
    expect(provenBy({ ...hmac, hash: 'sha1', encoding: 'base32' })).toMatchObject([
      [`${verify}/hash`, expect.any(String)],
      [`${verify}/encoding`, expect.any(String)],
    ]);
  });
});

describe('where a proof is', () => {
  it('is a header alone for a signature or a token, never an address or the message', () => {
    const fromAHeader =
      'Expected $request.header.<name>, a runtime expression of OpenAPI into the request, since a proof is taken from a header alone, never from an address or the message';

    expect(provenBy({ ...hmac, signature: '$request.body#/signature', timestamp: '$request.query.t' })).toEqual([
      [`${verify}/signature`, fromAHeader],
      [
        `${verify}/timestamp`,
        'Expected $request.header.<name> or $request.body#/<pointer>, a runtime expression of OpenAPI into the request',
      ],
    ]);
    expect(provenBy({ scheme: 'bearer', secret: 'app', token: '$request.query.token' })).toEqual([
      [`${verify}/token`, fromAHeader],
    ]);
  });
});

describe('the signed payload of a keyed hash', () => {
  const payloadOnce = 'Expected {payload} once, since the signature covers the body as the service sent it';

  it('signs the body once', () => {
    expect([
      provenBy({ ...hmac, signed_payload: '{timestamp}.{body}' }),
      provenBy({ ...hmac, signed_payload: '{timestamp}.{payload}.{payload}' }),
      provenBy({ ...hmac, signed_payload: 'v0:{timestamp}' }),
      provenBy({ ...hmac, signed_payload: 'payload' }),
    ]).toEqual([
      [
        [
          `${verify}/signed_payload`,
          'Holds {body}, which a signed payload does not have; it holds {id}, {timestamp} and {payload}',
        ],
      ],
      [[`${verify}/signed_payload`, payloadOnce]],
      [[`${verify}/signed_payload`, payloadOnce]],
      [[`${verify}/signed_payload`, payloadOnce]],
    ]);
  });

  it('signs the time and the id only where it names where they are', () => {
    expect(provenBy(without(hmac, 'id'))).toEqual([
      [
        `${verify}/signed_payload`,
        'Holds {id}, so expected id beside it, the header or the field of the body that holds it',
      ],
    ]);
  });
});
