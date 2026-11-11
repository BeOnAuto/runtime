import { Buffer } from 'node:buffer';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  isSignedByAnyOf,
  madeSigningSecret,
  presentedWebhookOf,
  signingKeyOf,
  webhookSignatureOf,
  type PresentedWebhook,
  type SigningKey,
} from '../index.ts';

const referenceSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

const referenceId = 'msg_p5jXN8AQM9LWM0D4loKWxJek';

const referenceTimestamp = 1614265330;

const referencePayload = new TextEncoder().encode('{"test": 2432232314}');

const everyByte = Uint8Array.from({ length: 256 }, (_, index) => index);

const nowMs = referenceTimestamp * 1000;

function keyOf(secret: string): SigningKey {
  const key = signingKeyOf(secret);
  if (key === undefined) {
    throw new Error('the test secret is no signing secret');
  }
  return key;
}

const referenceKey = keyOf(referenceSecret);

function headersOf(entries: Readonly<Record<string, string>>) {
  const headers = new Headers(entries);
  return (name: string) => headers.get(name);
}

function signedHeaders(signature: string, timestamp = referenceTimestamp, id = referenceId) {
  return headersOf({ 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': signature });
}

function presented(signature: string, timestamp = referenceTimestamp): PresentedWebhook {
  const webhook = presentedWebhookOf(signedHeaders(signature, timestamp), nowMs);
  if (typeof webhook === 'string') {
    throw new TypeError(`the test webhook was refused as ${webhook}`);
  }
  return webhook;
}

const referenceSignature = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';

describe('a signature of the Standard Webhooks specification', () => {
  it('is the reference implementation’s for its own test vector: v1 and the base64 of the HMAC-SHA256 of id, timestamp and body', () => {
    expect(webhookSignatureOf(referenceKey, referenceId, referenceTimestamp, referencePayload)).toBe(
      referenceSignature,
    );
  });

  it('signs a body of any bytes as sent, as the reference implementation’s vector of every byte value', () => {
    expect(webhookSignatureOf(referenceKey, referenceId, referenceTimestamp, everyByte)).toBe(
      'v1,sEcZ042G8Crqgxbybb3y0eDxQR3TcfYsk11I1XULhSI=',
    );
  });

  it('verifies the reference vector, and not a body with one byte changed', () => {
    const changed = Uint8Array.from(referencePayload);
    changed[2] = 0x75;

    expect(isSignedByAnyOf([referenceKey], presented(referenceSignature), referencePayload)).toBe(true);
    expect(isSignedByAnyOf([referenceKey], presented(referenceSignature), changed)).toBe(false);
  });

  it('takes a header of several signatures, as a sender rotating its secret sends, and skips those it cannot read', () => {
    const header = [
      'v1',
      'v1,not-base64!',
      'v2,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
      'v1,Ceo5qEr07ixe2NLpvHk3FH9bwy/WavXrAFQ/9tdO6mc=',
      referenceSignature,
    ].join(' ');

    expect(isSignedByAnyOf([referenceKey], presented(header), referencePayload)).toBe(true);
  });

  it('is verified by any one of the keys it is given, as a connection keeps its signing secret and the one it replaced', () => {
    const other = keyOf(`whsec_${Buffer.alloc(32, 9).toString('base64')}`);

    expect(isSignedByAnyOf([other, referenceKey], presented(referenceSignature), referencePayload)).toBe(true);
    expect(isSignedByAnyOf([other], presented(referenceSignature), referencePayload)).toBe(false);
    expect(isSignedByAnyOf([], presented(referenceSignature), referencePayload)).toBe(false);
  });

  it('refuses a signature under another version, as the reference implementation does', () => {
    expect(presentedWebhookOf(signedHeaders('v2,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='), nowMs)).toBe(
      'unsigned',
    );
  });
});

describe('what a request presents as a webhook', () => {
  it('is its id, its timestamp and the signatures it can read, the headers read whatever their case', () => {
    const webhook = presentedWebhookOf(
      headersOf({
        'Webhook-Id': referenceId,
        'WEBHOOK-TIMESTAMP': String(referenceTimestamp),
        'webhook-signature': referenceSignature,
      }),
      nowMs,
    );

    expect(webhook).toEqual({
      id: referenceId,
      timestamp: referenceTimestamp,
      signatures: [Uint8Array.from(Buffer.from('g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=', 'base64'))],
    });
  });

  it('is unsigned without each of the three headers, as the reference implementation refuses one', () => {
    const missing = [
      headersOf({ 'webhook-timestamp': '1614265330', 'webhook-signature': referenceSignature }),
      headersOf({ 'webhook-id': referenceId, 'webhook-signature': referenceSignature }),
      headersOf({ 'webhook-id': referenceId, 'webhook-timestamp': '1614265330' }),
    ].map((header) => presentedWebhookOf(header, nowMs));

    expect(missing).toEqual(['unsigned', 'unsigned', 'unsigned']);
  });
});

describe('what a request presents that is not taken as a webhook', () => {
  it('is unsigned for an id that holds a full stop or a comma, which the specification keeps out of what is signed, or one past 256 characters', () => {
    const refused = ['msg.1', 'msg,1', 'msg 1', 'a'.repeat(257), 'ü'].map((id) =>
      presentedWebhookOf(signedHeaders(referenceSignature, referenceTimestamp, id), nowMs),
    );

    expect(refused).toEqual(['unsigned', 'unsigned', 'unsigned', 'unsigned', 'unsigned']);
    expect(presentedWebhookOf(signedHeaders(referenceSignature, referenceTimestamp, 'a'.repeat(256)), nowMs)).not.toBe(
      'unsigned',
    );
  });

  it('is unsigned for a timestamp that is not whole seconds written plainly', () => {
    const refused = ['hello', '01614265330', '1614265330.5', '-1614265330', '1614265330abc', ''].map((timestamp) =>
      presentedWebhookOf(
        headersOf({
          'webhook-id': referenceId,
          'webhook-timestamp': timestamp,
          'webhook-signature': referenceSignature,
        }),
        nowMs,
      ),
    );

    expect(refused).toEqual(['unsigned', 'unsigned', 'unsigned', 'unsigned', 'unsigned', 'unsigned']);
  });

  it('is unsigned for a header that holds no signature it can read, a partial one among them', () => {
    const refused = [referenceSignature.slice(0, 8), 'v1,', 'v1,dawfeoifkpqwoekfpqoekf', `v1,${'A'.repeat(2100)}`].map(
      (signature) => presentedWebhookOf(signedHeaders(signature), nowMs),
    );

    expect(refused).toEqual(['unsigned', 'unsigned', 'unsigned', 'unsigned']);
  });

  it('is unsigned for a header of more than 2 KiB, however many signatures it holds', () => {
    const signatures = Array.from({ length: 44 }, () => referenceSignature).join(' ');

    expect(Buffer.byteLength(signatures)).toBeGreaterThan(2048);
    expect(presentedWebhookOf(signedHeaders(signatures), nowMs)).toBe('unsigned');
  });
});

describe('the time of a webhook', () => {
  it('is stale more than five minutes from now, either way, and taken at five minutes exactly', () => {
    const ats = [-301, -300, 300, 301].map((seconds) =>
      presentedWebhookOf(signedHeaders(referenceSignature, referenceTimestamp + seconds), nowMs),
    );

    expect(ats.map((webhook) => typeof webhook)).toEqual(['string', 'object', 'object', 'string']);
    expect([ats[0], ats[3]]).toEqual(['stale', 'stale']);
  });
});

describe('a signing secret', () => {
  it('is whsec_ and the base64 of 24 to 64 bytes, as the specification serializes one', () => {
    const lengths = [23, 24, 64, 65].map(
      (bytes) => signingKeyOf(`whsec_${Buffer.alloc(bytes, 1).toString('base64')}`) !== undefined,
    );

    expect(lengths).toEqual([false, true, true, false]);
  });

  it('is refused without its prefix, empty, or with text that is not base64', () => {
    const refused = ['MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'whsec_', '', 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLa!w'].map(
      (secret) => signingKeyOf(secret),
    );

    expect(refused).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('is made of 32 random bytes, a new one each time, and verifies what it signs', () => {
    const [first, second] = [madeSigningSecret(), madeSigningSecret()].map((made) => Redacted.value(made));
    const key = keyOf(String(first));
    const signature = webhookSignatureOf(key, referenceId, referenceTimestamp, referencePayload);

    expect(first).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/u);
    expect(first).not.toBe(second);
    expect(isSignedByAnyOf([key], presented(signature), referencePayload)).toBe(true);
    expect(JSON.stringify(madeSigningSecret())).toBe('"<redacted>"');
  });
});
