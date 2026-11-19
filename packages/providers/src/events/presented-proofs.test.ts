import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { eventDestinationOf } from '../reading/provider-list.ts';
import { ofEachSubscription, ofTheApp, overASocket, trackerOverASocket } from '../testing/event-destinations.ts';
import { providersOf } from '../testing/fixture-providers.ts';
import { presentedProofOf, type Arrival, type PresentedProof } from './arrival-readings.ts';
import type { Destination } from './destination-fields.ts';
import { provesWhatIsReadAt } from './event-proofs.ts';

type Reader = (arrival: Arrival) => PresentedProof | undefined;

function destinationOf(declared: object, type: 'webhook' | 'websocket' = 'webhook'): Destination {
  const entry = { ...trackerOverASocket, events: { destinations: [declared] } };
  const destination = eventDestinationOf(providersOf(entry), 'tracker', type);
  if (destination === undefined) {
    throw new Error('the test destination is refused');
  }
  return destination;
}

function readerOf(declared: object): Reader {
  const destination = destinationOf(declared);
  return (arrival) => presentedProofOf(destination, arrival);
}

function verifiedAs(verify: object): Reader {
  return readerOf({ ...ofTheApp, verify: { secret: 'app', ...verify } });
}

function proofOf(verify: object): NonNullable<Destination['verify']> {
  const { verify: proof } = destinationOf({ ...ofTheApp, verify: { secret: 'app', ...verify } });
  if (proof === undefined) {
    throw new Error('the test destination declares no proof');
  }
  return proof;
}

function aRequest(headers: Readonly<Record<string, string>>, body: Schema.Json = {}): Arrival {
  return { transport: 'request', headers, query: {}, body };
}

const signedWithItsTime = readerOf(ofTheApp);

const signedWithAnId = readerOf(ofEachSubscription);

const timedInTheBody = readerOf({
  ...ofEachSubscription,
  verify: { ...ofEachSubscription.verify, timestamp: '$request.body#/sent_at' },
});

const aTimedSignature = { 'x-chat-signature': 'v0=a2114d57', 'x-chat-request-timestamp': '1531420618' };

describe('the proof an hmac delivery presents', () => {
  it('is the signature and the time where the entry declares them, the headers read whatever their case', () => {
    const presented = signedWithItsTime(
      aRequest({ 'X-Chat-Signature': 'v0=a2114d57', 'X-CHAT-REQUEST-TIMESTAMP': '1531420618' }),
    );

    expect(presented).toEqual({ signature: 'v0=a2114d57', timestamp: '1531420618' });
  });

  it('is the signature and the id of the delivery where the entry declares an id', () => {
    const presented = signedWithAnId(
      aRequest({ 'x-tracker-signature': 'sha256=7571', 'x-tracker-delivery': 'delivery-42', ...aTimedSignature }),
    );

    expect(presented).toEqual({ signature: 'sha256=7571', id: 'delivery-42' });
  });

  it('is a time the body holds, as text or as a number', () => {
    const signed = { 'x-tracker-signature': 'sha256=7571', 'x-tracker-delivery': 'delivery-42' };
    const times = [1_531_420_618, '1531420618'].map((sentAt) => timedInTheBody(aRequest(signed, { sent_at: sentAt })));

    expect(times.map((presented) => presented?.timestamp)).toEqual([1_531_420_618, '1531420618']);
  });

  it('is the signature as it arrived, every value of its header joined as a recipient may join them', () => {
    const presented = signedWithItsTime(
      aRequest({
        'x-chat-signature': 'v0=a2114d57',
        'X-Chat-Signature': 'v0=b3225e68',
        'x-chat-request-timestamp': '1',
      }),
    );

    expect(presented?.signature).toBe('v0=a2114d57, v0=b3225e68');
  });
});

describe('a delivery that presents no proof', () => {
  it('is one that lacks a part its entry declares, or holds it as empty text', () => {
    const lacking = [
      aRequest({ 'x-chat-request-timestamp': '1531420618' }),
      aRequest({ 'x-chat-signature': 'v0=a2114d57' }),
      aRequest({ 'x-chat-signature': '', 'x-chat-request-timestamp': '1531420618' }),
      aRequest({ 'x-chat-signature': 'v0=a2114d57', 'x-chat-request-timestamp': '' }),
    ].map((arrival) => signedWithItsTime(arrival));

    expect(lacking).toEqual([undefined, undefined, undefined, undefined]);
    expect(signedWithAnId(aRequest({ 'x-tracker-signature': 'sha256=7571' }))).toBeUndefined();
  });

  it('is one whose body holds its time as neither text nor a number', () => {
    const signed = { 'x-tracker-signature': 'sha256=7571', 'x-tracker-delivery': 'delivery-42' };
    const times: readonly Schema.Json[] = [null, true, { at: 1 }, ['1531420618']];

    const presented = times.map((sentAt) => timedInTheBody(aRequest(signed, { sent_at: sentAt })));

    expect(presented).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('is a message, or an arrival at a destination that declares no proof', () => {
    const message: Arrival = { transport: 'message', headers: aTimedSignature, payload: {} };
    const overTheSocket = destinationOf(overASocket, 'websocket');

    expect(signedWithItsTime(message)).toBeUndefined();
    expect(presentedProofOf(overTheSocket, aRequest(aTimedSignature))).toBeUndefined();
  });
});

describe('the proof a token or a Standard Webhooks delivery presents', () => {
  it('is the token as its header holds it, its prefix with it, for bearer and for jwt', () => {
    const asBearer = verifiedAs({ scheme: 'bearer', token: '$request.header.Authorization', prefix: 'Bearer ' });
    const asJwt = verifiedAs({ scheme: 'jwt', token: '$request.header.Authorization', alg: 'HS256' });
    const arrival = aRequest({ authorization: 'Bearer a-token', ...aTimedSignature });

    expect([asBearer(arrival), asJwt(arrival)]).toEqual([{ token: 'Bearer a-token' }, { token: 'Bearer a-token' }]);
    expect(asBearer(aRequest(aTimedSignature))).toBeUndefined();
  });

  it('is the request’s headers, read by the names the specification fixes whatever their case', () => {
    const presented = verifiedAs({ scheme: 'standard-webhooks' })(
      aRequest({ 'Webhook-Id': 'msg_1', 'webhook-signature': 'v1,abc', 'WEBHOOK-SIGNATURE': 'v1,def' }),
    );
    const header = presented?.header;

    expect(Object.keys({ ...presented })).toEqual(['header']);
    expect([header?.('webhook-id'), header?.('Webhook-Signature'), header?.('webhook-timestamp')]).toEqual([
      'msg_1',
      'v1,abc, v1,def',
      undefined,
    ]);
  });
});

describe('what a proof proves of what a delivery holds', () => {
  it('is what is read from the body, where the proof signs the body, and never what a header or the query holds', () => {
    const read = ['$request.body#/check/token', '$request.header.X-Check', '$request.query.check'];
    const proofs = [
      proofOf(ofTheApp.verify),
      proofOf({ scheme: 'standard-webhooks' }),
      proofOf({ scheme: 'bearer', token: '$request.header.Authorization', prefix: 'Bearer ' }),
      proofOf({ scheme: 'jwt', token: '$request.header.Authorization', alg: 'HS256' }),
    ];

    const proven = proofs.map((proof) => read.map((expression) => provesWhatIsReadAt(proof, expression)));

    expect(proven).toEqual([
      [true, false, false],
      [true, false, false],
      [false, false, false],
      [false, false, false],
    ]);
  });
});
