import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { ofTheApp, without } from '../testing/event-destinations.ts';
import { tracker } from '../testing/fixture-providers.ts';

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
