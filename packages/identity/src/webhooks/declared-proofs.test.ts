import { Buffer } from 'node:buffer';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { checkedProof, type DeclaredProof, type PresentedProof, type ProofCheck } from '../index.ts';

const referenceSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

const referenceTimestamp = 1_614_265_330;

const referenceBody = new TextEncoder().encode('{"test": 2432232314}');

function checkOf(
  declared: DeclaredProof,
  presented: PresentedProof,
  secrets: readonly string[],
  nowMs = referenceTimestamp * 1000,
): Promise<ProofCheck> {
  return checkedProof(
    declared,
    presented,
    secrets.map((secret) => Redacted.make(secret)),
    { body: referenceBody, nowMs },
  );
}

function headersOf(entries: Readonly<Record<string, string>>): PresentedProof {
  const headers = new Headers(entries);
  return { header: (name: string) => headers.get(name) };
}

const referenceHeaders = headersOf({
  'Webhook-Id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  'Webhook-Timestamp': String(referenceTimestamp),
  'Webhook-Signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
});

const standardWebhooks: DeclaredProof = { scheme: 'standard-webhooks' };

describe('a delivery signed as the Standard Webhooks specification signs one', () => {
  it('is proven for the reference implementation’s vector, from the headers the specification names', async () => {
    await expect(checkOf(standardWebhooks, referenceHeaders, [referenceSecret])).resolves.toBe('proven');
  });

  it('is stale past the specification’s tolerance, and unsigned without its headers', async () => {
    const later = (referenceTimestamp + 301) * 1000;

    await expect(checkOf(standardWebhooks, referenceHeaders, [referenceSecret], later)).resolves.toBe('stale');
    await expect(checkOf(standardWebhooks, headersOf({}), [referenceSecret])).resolves.toBe('unsigned');
    await expect(checkOf(standardWebhooks, {}, [referenceSecret])).resolves.toBe('unsigned');
  });

  it('is mismatched under another subscription’s secret, and passes over a secret not written as one', async () => {
    const another = `whsec_${Buffer.alloc(32, 9).toString('base64')}`;
    const unwritten = referenceSecret.slice('whsec_'.length);

    await expect(checkOf(standardWebhooks, referenceHeaders, [another])).resolves.toBe('mismatched');
    await expect(checkOf(standardWebhooks, referenceHeaders, [unwritten])).resolves.toBe('mismatched');
    await expect(checkOf(standardWebhooks, referenceHeaders, [another, referenceSecret])).resolves.toBe('proven');
  });
});

const bearer: DeclaredProof = { scheme: 'bearer', prefix: 'Bearer ' };

describe('a secret presented as a bearer token', () => {
  it('is proven where it is the secret, after the declared prefix or with none declared', async () => {
    await expect(checkOf(bearer, { token: 'Bearer a-subscription-secret' }, ['a-subscription-secret'])).resolves.toBe(
      'proven',
    );
    await expect(
      checkOf({ scheme: 'bearer' }, { token: 'a-subscription-secret' }, ['a-subscription-secret']),
    ).resolves.toBe('proven');
  });

  it('is mismatched for the secret of another subscription, of the same length or another', async () => {
    const presented = { token: 'Bearer a-subscription-secret' };
    const secrets = ['b-subscription-secret', 'a-subscription-secre', 'a-subscription-secret-and-more'];
    const checks = await Promise.all(secrets.map((secret) => checkOf(bearer, presented, [secret])));

    expect(checks).toEqual(['mismatched', 'mismatched', 'mismatched']);
    await expect(checkOf(bearer, presented, ['another', 'a-subscription-secret'])).resolves.toBe('proven');
    await expect(checkOf(bearer, presented, [])).resolves.toBe('mismatched');
  });

  it('is unsigned after another prefix, with nothing after the prefix, or without a token', async () => {
    const presented: readonly PresentedProof[] = [
      { token: 'bearer a-subscription-secret' },
      { token: 'a-subscription-secret' },
      { token: 'Bearer ' },
      {},
    ];
    const checks = await Promise.all(presented.map((token) => checkOf(bearer, token, ['a-subscription-secret'])));

    expect(checks).toEqual(['unsigned', 'unsigned', 'unsigned', 'unsigned']);
  });

  it('passes over a secret that is empty, so that no token is taken for one', async () => {
    await expect(checkOf({ scheme: 'bearer' }, { token: 'anything' }, [''])).resolves.toBe('mismatched');
  });
});

describe('a proof checked as its entry declares', () => {
  it('is unsigned where the delivery presents no part the declared scheme reads', async () => {
    const declarations: readonly DeclaredProof[] = [
      { scheme: 'hmac', hash: 'sha256', signed_payload: '{payload}', encoding: 'hex' },
      bearer,
      { scheme: 'jwt', alg: 'HS256' },
      standardWebhooks,
    ];
    const presented: PresentedProof = { timestamp: String(referenceTimestamp), id: 'msg_p5jXN8AQM9LWM0D4loKWxJek' };
    const checks = await Promise.all(declarations.map((declared) => checkOf(declared, presented, [referenceSecret])));

    expect(checks).toEqual(['unsigned', 'unsigned', 'unsigned', 'unsigned']);
  });

  it('reads only the part its own scheme reads, so a bearer token is no hmac signature', async () => {
    const declared: DeclaredProof = { scheme: 'hmac', hash: 'sha256', signed_payload: '{payload}', encoding: 'hex' };

    await expect(checkOf(declared, { token: 'a-subscription-secret' }, ['a-subscription-secret'])).resolves.toBe(
      'unsigned',
    );
  });
});
