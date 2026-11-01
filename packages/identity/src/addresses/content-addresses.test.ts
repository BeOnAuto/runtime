import { createHmac } from 'node:crypto';

import { sha256Of } from '@on.auto/content';
import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { contentAddressesUnder, contentAddressLastsSeconds, contentPathOf, type ContentSignature } from '../index.ts';

const keyBytes = new Uint8Array(32).fill(7);

const key = Redacted.make(keyBytes);

const alpha = { org: 'acme', playbook: 'alpha' };

const sha256 = sha256Of('an image');

const now = 1_800_000_000;

const addresses = contentAddressesUnder(key, () => now * 1000 + 999);

function signatureOf(signed: string): string {
  return createHmac('sha256', keyBytes).update(signed).digest('hex');
}

function later(seconds: number) {
  return contentAddressesUnder(key, () => (now + seconds) * 1000);
}

function signedWithTheKey(digest: string, until: number): ContentSignature {
  return { until: String(until), sig: signatureOf(JSON.stringify(['acme', 'alpha', digest, String(until)])) };
}

function signatureIn(address: string | undefined): ContentSignature {
  const { searchParams } = new URL(String(address));
  return { until: searchParams.get('until') ?? undefined, sig: searchParams.get('sig') ?? undefined };
}

describe('the address of a content the runtime signs', () => {
  it("is the content's path on the runtime's own origin, with the time it lasts until and the HMAC-SHA256 of the playbook, the digest and that time", () => {
    const until = now + 60;

    const address = addresses.signedContentAddress('https://runtime.example', alpha, sha256, until);

    expect(address).toBe(
      `https://runtime.example/v1/orgs/acme/playbooks/alpha/content/${sha256}?until=${until}&sig=${signatureOf(
        JSON.stringify(['acme', 'alpha', sha256, String(until)]),
      )}`,
    );
    expect(contentPathOf(alpha, sha256)).toBe(`/v1/orgs/acme/playbooks/alpha/content/${sha256}`);
  });

  it('lasts 15 minutes at the most, a time later than that brought back to it and a part of a second dropped', () => {
    const lasting = [now + 2 * contentAddressLastsSeconds, now + 30.9].map(
      (until) => signatureIn(addresses.signedContentAddress('http://localhost:5555', alpha, sha256, until)).until,
    );

    expect(contentAddressLastsSeconds).toBe(900);
    expect(lasting).toEqual([String(now + 900), String(now + 30)]);
  });

  it('is made for an https origin or one on this computer alone, as the links to Studio are', () => {
    const made = [
      'https://runtime.example',
      'http://127.0.0.1:5555',
      'http://[::1]:5555',
      'http://runtime.example',
    ].map((origin) => addresses.signedContentAddress(origin, alpha, sha256, now + 60) !== undefined);

    expect(made).toEqual([true, true, true, false]);
  });

  it('is the same on an origin written with a final slash, and none on an origin that does not parse', () => {
    const [withoutSlash, withSlash, unparsed] = ['https://runtime.example', 'https://runtime.example/', 'runtime'].map(
      (origin) => addresses.signedContentAddress(origin, alpha, sha256, now + 60),
    );

    expect([withSlash, unparsed]).toEqual([withoutSlash, undefined]);
    expect(withSlash).not.toContain('//v1');
  });
});

describe('an address the runtime could never have signed', () => {
  it('is not for any content where its digest is not 64 lowercase hex digits, or it lasts longer than an address may and the 30 seconds two clocks may differ by, however it is signed', () => {
    expect([
      addresses.checkedAddress(alpha, sha256, signedWithTheKey(sha256, now + 930)),
      addresses.checkedAddress(alpha, sha256, signedWithTheKey(sha256, now + 931)),
      addresses.checkedAddress(alpha, sha256.toUpperCase(), signedWithTheKey(sha256.toUpperCase(), now + 60)),
      addresses.checkedAddress(alpha, 'an-image', signedWithTheKey('an-image', now + 60)),
    ]).toEqual(['signed', 'not_for_this_content', 'not_for_this_content', 'not_for_this_content']);
  });
});

describe('an address signed by a server whose clock is ahead of the one that checks it', () => {
  it('is signed for its whole life when the signer is 29 seconds ahead, and not for the content 31 seconds past the most an address lasts', () => {
    const ahead = contentAddressesUnder(key, () => (now + 29) * 1000);
    const signedAhead = signatureIn(ahead.signedContentAddress('https://runtime.example', alpha, sha256, now + 2000));

    expect([
      signedAhead.until,
      addresses.checkedAddress(alpha, sha256, signedAhead),
      addresses.checkedAddress(alpha, sha256, signedWithTheKey(sha256, now + contentAddressLastsSeconds + 31)),
    ]).toEqual([String(now + 929), 'signed', 'not_for_this_content']);
  });
});

describe('an address of a content presented to the runtime', () => {
  const presented = signatureIn(addresses.signedContentAddress('https://runtime.example', alpha, sha256, now + 60));

  it('is signed until the time it names, and expired once that second has passed', () => {
    expect([
      addresses.checkedAddress(alpha, sha256, presented),
      later(60).checkedAddress(alpha, sha256, presented),
      later(61).checkedAddress(alpha, sha256, presented),
    ]).toEqual(['signed', 'signed', 'expired']);
  });

  it('is not for a content of another digest, playbook or org, for another time, or under another key', () => {
    const otherKey = contentAddressesUnder(Redacted.make(new Uint8Array(32).fill(8)), () => now * 1000);

    expect([
      addresses.checkedAddress(alpha, sha256Of('another image'), presented),
      addresses.checkedAddress({ ...alpha, playbook: 'beta' }, sha256, presented),
      addresses.checkedAddress({ ...alpha, org: 'globex' }, sha256, presented),
      addresses.checkedAddress(alpha, sha256, { ...presented, until: String(now + 61) }),
      otherKey.checkedAddress(alpha, sha256, presented),
    ]).toEqual(Array.from({ length: 5 }, () => 'not_for_this_content'));
  });

  it('is not for the content without its time or its signature, or with either written otherwise', () => {
    const { until = '', sig = '' } = presented;
    const writtenOtherwise: readonly ContentSignature[] = [
      { until: undefined, sig },
      { until, sig: undefined },
      { until: `0${until}`, sig },
      { until: `${until}.0`, sig },
      { until: '9'.repeat(16), sig },
      { until, sig: sig.toUpperCase() },
      { until, sig: sig.slice(2) },
      { until, sig: `${sig}00` },
      { until, sig: `${sig.slice(0, -1)}g` },
    ];

    expect(writtenOtherwise.map((signature) => addresses.checkedAddress(alpha, sha256, signature))).toEqual(
      Array.from({ length: 9 }, () => 'not_for_this_content'),
    );
  });
});
