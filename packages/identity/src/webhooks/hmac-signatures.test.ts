import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { checkedProof, hmacOf, type DeclaredProof, type PresentedProof, type ProofCheck } from '../index.ts';

const utf8 = new TextEncoder();

interface Delivery {
  readonly declared: DeclaredProof;
  readonly presented: PresentedProof;
  readonly body: Readonly<Uint8Array>;
  readonly secret: string;
}

const sentAtMs = 1_531_420_618_000;

function checkOf(
  delivery: Delivery,
  nowMs = sentAtMs,
  secrets: readonly string[] = [delivery.secret],
): Promise<ProofCheck> {
  const { declared, presented, body } = delivery;
  return checkedProof(
    declared,
    presented,
    secrets.map((secret) => Redacted.make(secret)),
    { body, nowMs },
  );
}

function checksOf(deliveries: readonly Delivery[]): Promise<readonly ProofCheck[]> {
  return Promise.all(deliveries.map((delivery) => checkOf(delivery)));
}

const signedBodyAlone: Delivery = {
  declared: { scheme: 'hmac', hash: 'sha256', signed_payload: '{payload}', prefix: 'sha256=', encoding: 'hex' },
  presented: { signature: 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17' },
  body: utf8.encode('Hello, World!'),
  secret: "It's a Secret to Everybody",
};

const signedWithItsTime: Delivery = {
  declared: {
    scheme: 'hmac',
    hash: 'sha256',
    signed_payload: 'v0:{timestamp}:{payload}',
    prefix: 'v0=',
    encoding: 'hex',
  },
  presented: {
    signature: 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503',
    timestamp: '1531420618',
  },
  body: utf8.encode(
    'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c',
  ),
  secret: '8f742231b10e8888abcd99yyyzzz85a5',
};

function signedAs(delivery: Delivery, signature: string): Delivery {
  return { ...delivery, presented: { ...delivery.presented, signature } };
}

function declaredAs(delivery: Delivery, declared: Partial<DeclaredProof>): Delivery {
  return { ...delivery, declared: { ...delivery.declared, ...declared } };
}

function declaredOnly(declared: DeclaredProof): Delivery {
  return { ...signedBodyAlone, declared };
}

function withTimestamp(delivery: Delivery, timestamp?: string | number): Delivery {
  const { signature } = delivery.presented;
  const presented = signature === undefined ? {} : { signature };
  return { ...delivery, presented: timestamp === undefined ? presented : { ...presented, timestamp } };
}

const rfc4231Case2 = {
  key: 'Jefe',
  data: utf8.encode('what do ya want for nothing?'),
  macs: {
    sha256: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    sha384: 'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
    sha512:
      '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
  },
} as const;

function ofRfc4231(hash: keyof typeof rfc4231Case2.macs, encoding: 'hex' | 'base64'): Delivery {
  const mac = rfc4231Case2.macs[hash];
  return {
    declared: { scheme: 'hmac', hash, signed_payload: '{payload}', encoding },
    presented: { signature: encoding === 'hex' ? mac : Buffer.from(mac, 'hex').toString('base64') },
    body: rfc4231Case2.data,
    secret: rfc4231Case2.key,
  };
}

describe('a signature of the body alone, hex after its prefix', () => {
  it('is proven for the published vector of a body signed alone', async () => {
    await expect(checkOf(signedBodyAlone)).resolves.toBe('proven');
  });

  it('is mismatched for the body changed by one byte', async () => {
    const changed = Uint8Array.from(signedBodyAlone.body);
    changed[7] = 0x77;

    await expect(checkOf({ ...signedBodyAlone, body: changed })).resolves.toBe('mismatched');
  });

  it('is mismatched under the secret of another subscription, and proven under any one of several', async () => {
    await expect(checkOf(signedBodyAlone, sentAtMs, ['another subscription’s secret'])).resolves.toBe('mismatched');
    await expect(checkOf(signedBodyAlone, sentAtMs, ['another', signedBodyAlone.secret])).resolves.toBe('proven');
    await expect(checkOf(signedBodyAlone, sentAtMs, [])).resolves.toBe('mismatched');
  });
});

describe('a signature not written as the entry declares', () => {
  it('is unsigned after another prefix, with nothing after its prefix, or without it', async () => {
    const mac = '757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
    const signatures = [`sha1=${mac}`, `SHA256=${mac}`, 'sha256=', mac];

    await expect(checksOf(signatures.map((signature) => signedAs(signedBodyAlone, signature)))).resolves.toEqual([
      'unsigned',
      'unsigned',
      'unsigned',
      'unsigned',
    ]);
  });

  it('is unsigned for a signature of another length than its hash gives', async () => {
    const mac = '757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
    const signatures = [mac.slice(0, -2), `${mac}00`, mac.slice(0, -1)].map((written) => `sha256=${written}`);

    await expect(checksOf(signatures.map((signature) => signedAs(signedBodyAlone, signature)))).resolves.toEqual([
      'unsigned',
      'unsigned',
      'unsigned',
    ]);
  });

  it('is unsigned written in an encoding other than the declared one, and read in hex of either case', async () => {
    const mac = Buffer.from('757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17', 'hex');
    const signatures = [mac.toString('base64'), mac.toString('base64url'), `${mac.toString('hex').slice(2)}zz`];

    await expect(
      checksOf(signatures.map((written) => signedAs(signedBodyAlone, `sha256=${written}`))),
    ).resolves.toEqual(['unsigned', 'unsigned', 'unsigned']);
    await expect(checkOf(signedAs(signedBodyAlone, `sha256=${mac.toString('hex').toUpperCase()}`))).resolves.toBe(
      'proven',
    );
  });
});

describe('a signature of a time and the body', () => {
  it('is proven for the published vector at the time it was sent', async () => {
    await expect(checkOf(signedWithItsTime)).resolves.toBe('proven');
  });

  it('is taken five minutes either side of its time, and stale a second further', async () => {
    const checks = await Promise.all(
      [-301, -300, 300, 301].map((seconds) => checkOf(signedWithItsTime, sentAtMs + seconds * 1000)),
    );

    expect(checks).toEqual(['stale', 'proven', 'proven', 'stale']);
  });

  it('is mismatched for a time other than the one signed, within the tolerance, or a body changed by one byte', async () => {
    const changed = Uint8Array.from(signedWithItsTime.body);
    changed[0] = 0x54;

    await expect(checkOf(withTimestamp(signedWithItsTime, '1531420619'))).resolves.toBe('mismatched');
    await expect(checkOf({ ...signedWithItsTime, body: changed })).resolves.toBe('mismatched');
  });

  it('is unsigned without its time, or with one that is not whole seconds written plainly', async () => {
    const times = [undefined, '1531420618.0', '01531420618', ' 1531420618', '-1531420618', 1_531_420_618.5];

    await expect(checksOf(times.map((time) => withTimestamp(signedWithItsTime, time)))).resolves.toEqual(
      times.map(() => 'unsigned'),
    );
  });

  it('takes a time a body holds as a number, as the decimal it writes', async () => {
    await expect(checkOf(withTimestamp(signedWithItsTime, 1_531_420_618))).resolves.toBe('proven');
  });

  it('checks the time a delivery presents even where the time is not signed', async () => {
    const timed = withTimestamp(signedBodyAlone, '1531420618');

    await expect(checkOf(timed, sentAtMs + 301_000)).resolves.toBe('stale');
    await expect(checkOf(timed)).resolves.toBe('proven');
  });
});

describe('the hash of an hmac', () => {
  it('is HMAC-SHA-256, -384 and -512 as RFC 4231 computes them, written in hex or in base64', async () => {
    const hashes = ['sha256', 'sha384', 'sha512'] as const;
    const deliveries = hashes.flatMap((hash) => [ofRfc4231(hash, 'hex'), ofRfc4231(hash, 'base64')]);

    await expect(checksOf(deliveries)).resolves.toEqual(deliveries.map(() => 'proven'));
  });

  it('is unsigned for the mac of another hash than the declared one', async () => {
    const sha256 = ofRfc4231('sha256', 'hex');

    await expect(checkOf(declaredAs(sha256, { hash: 'sha512' }))).resolves.toBe('unsigned');
  });
});

describe('the hmac a handshake is answered with', () => {
  it('is made as RFC 4231 computes it, in the declared hash and encoding without the prefix, and nothing without them', () => {
    const vectors = (['sha256', 'sha384', 'sha512'] as const).flatMap((hash) => [
      ofRfc4231(hash, 'hex'),
      ofRfc4231(hash, 'base64'),
    ]);
    const challenge = 'what do ya want for nothing?';
    const without: readonly DeclaredProof[] = [
      { scheme: 'hmac', encoding: 'hex' },
      { scheme: 'hmac', hash: 'sha256' },
    ];

    expect(
      vectors.map(({ declared, secret }) => hmacOf({ ...declared, prefix: 'v0=' }, Redacted.make(secret), challenge)),
    ).toEqual(vectors.map(({ presented }) => presented.signature));
    expect(without.map((declared) => hmacOf(declared, Redacted.make('Jefe'), challenge))).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('a signed payload', () => {
  it('joins the id, the time and the body as the signed payload lays them out', async () => {
    const id = 'delivery-42';
    const body = utf8.encode('{"event":"comment"}');
    const mac = createHmac('sha256', 'a subscription’s secret').update(`${id}.1531420618.`).update(body).digest('hex');
    const delivery: Delivery = {
      declared: { scheme: 'hmac', hash: 'sha256', signed_payload: '{id}.{timestamp}.{payload}', encoding: 'hex' },
      presented: { signature: mac, timestamp: '1531420618', id },
      body,
      secret: 'a subscription’s secret',
    };

    await expect(checkOf(delivery)).resolves.toBe('proven');
    await expect(checkOf({ ...delivery, presented: { signature: mac, timestamp: '1531420618' } })).resolves.toBe(
      'unsigned',
    );
    await expect(checkOf({ ...delivery, presented: { ...delivery.presented, id: 'delivery-43' } })).resolves.toBe(
      'mismatched',
    );
  });

  it('covers the body exactly once: a declaration that signs it never or twice proves nothing', async () => {
    const twice = createHmac('sha256', signedBodyAlone.secret)
      .update(signedBodyAlone.body)
      .update(signedBodyAlone.body)
      .digest('hex');
    const never = createHmac('sha256', signedBodyAlone.secret).update('1531420618').digest('hex');
    const deliveries = [
      signedAs(declaredAs(signedBodyAlone, { signed_payload: '{payload}{payload}' }), `sha256=${twice}`),
      withTimestamp(
        signedAs(declaredAs(signedBodyAlone, { signed_payload: '{timestamp}' }), `sha256=${never}`),
        '1531420618',
      ),
    ];

    await expect(checksOf(deliveries)).resolves.toEqual(['unsigned', 'unsigned']);
  });
});

describe('what an hmac proves nothing with', () => {
  it('proves nothing for a declaration without its hash, its encoding or its signed payload', async () => {
    const declarations: readonly DeclaredProof[] = [
      { scheme: 'hmac', encoding: 'hex', signed_payload: '{payload}', prefix: 'sha256=' },
      { scheme: 'hmac', hash: 'sha256', signed_payload: '{payload}', prefix: 'sha256=' },
      { scheme: 'hmac', hash: 'sha256', encoding: 'hex', prefix: 'sha256=' },
    ];

    await expect(checksOf(declarations.map((declared) => declaredOnly(declared)))).resolves.toEqual([
      'unsigned',
      'unsigned',
      'unsigned',
    ]);
  });

  it('passes over a secret that is empty, which would key a mac anyone can make', async () => {
    const underNoSecret = createHmac('sha256', '').update(signedBodyAlone.body).digest('hex');

    await expect(checkOf(signedAs(signedBodyAlone, `sha256=${underNoSecret}`), sentAtMs, [''])).resolves.toBe(
      'mismatched',
    );
  });
});
