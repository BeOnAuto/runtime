import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { checkedProof, refusalAmong, type DeclaredProof, type ProofCheck } from '../index.ts';

type Claims = Readonly<Record<string, unknown>>;

const nowSeconds = 1_700_000_000;

const publishedToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30';

const publishedSecret = 'a-string-secret-at-least-256-bits-long';

const unsecuredToken =
  'eyJhbGciOiJub25lIn0.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.';

const inAHeader: DeclaredProof = { scheme: 'jwt', alg: 'HS256', prefix: 'Bearer ' };

const hashOf = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' } as const;

function partOf(json: Claims): string {
  return Buffer.from(JSON.stringify(json)).toString('base64url');
}

function tokenOf(header: Claims, claims: Claims, secret = publishedSecret): string {
  const alg = header['alg'];
  const hash = alg === 'HS384' || alg === 'HS512' ? hashOf[alg] : hashOf.HS256;
  const signing = `${partOf(header)}.${partOf(claims)}`;
  return `${signing}.${createHmac(hash, secret).update(signing).digest('base64url')}`;
}

const aDelivery: Claims = { sub: 'delivery' };

function signedWith(alg: string, claims = aDelivery, secret = publishedSecret): string {
  return tokenOf({ alg, typ: 'JWT' }, claims, secret);
}

function checkOf(
  presented: string,
  declared: DeclaredProof = inAHeader,
  secrets: readonly string[] = [publishedSecret],
): Promise<ProofCheck> {
  return checkedProof(
    declared,
    { token: presented },
    secrets.map((secret) => Redacted.make(secret)),
    { body: new Uint8Array(), nowMs: nowSeconds * 1000 },
  );
}

function checksOf(tokens: readonly string[], declared: DeclaredProof = inAHeader): Promise<readonly ProofCheck[]> {
  return Promise.all(tokens.map((token) => checkOf(`Bearer ${token}`, declared)));
}

describe('a JSON Web Token signed with HMAC', () => {
  it('is proven for the published example token, after its prefix', async () => {
    expect(
      tokenOf({ alg: 'HS256', typ: 'JWT' }, { sub: '1234567890', name: 'John Doe', admin: true, iat: 1_516_239_022 }),
    ).toBe(publishedToken);
    await expect(checkOf(`Bearer ${publishedToken}`)).resolves.toBe('proven');
    await expect(checkOf(publishedToken, { scheme: 'jwt', alg: 'HS256' })).resolves.toBe('proven');
  });

  it('is proven under HS384 and HS512 where those are declared', async () => {
    const checks = await Promise.all(
      (['HS384', 'HS512'] as const).map((alg) =>
        checkOf(`Bearer ${signedWith(alg)}`, { scheme: 'jwt', alg, prefix: 'Bearer ' }),
      ),
    );

    expect(checks).toEqual(['proven', 'proven']);
  });

  it('is unsigned under an algorithm other than the declared one, however it is signed', async () => {
    const declaredHs512: DeclaredProof = { scheme: 'jwt', alg: 'HS512', prefix: 'Bearer ' };

    await expect(checksOf([signedWith('HS512'), signedWith('HS384')])).resolves.toEqual(['unsigned', 'unsigned']);
    await expect(checksOf([publishedToken], declaredHs512)).resolves.toEqual(['unsigned']);
  });

  it('is unsigned for alg none, the published unsecured token and one made of a signed token’s claims', async () => {
    const [, claims = ''] = publishedToken.split('.');
    const withNone = `${partOf({ alg: 'none', typ: 'JWT' })}.${claims}.`;

    await expect(checksOf([unsecuredToken, withNone])).resolves.toEqual(['unsigned', 'unsigned']);
  });
});

describe('the secret of a JSON Web Token', () => {
  it('is mismatched under the secret of another subscription, and proven under any one of several', async () => {
    const presented = `Bearer ${publishedToken}`;

    await expect(checkOf(presented, inAHeader, ['another subscription’s secret'])).resolves.toBe('mismatched');
    await expect(checkOf(presented, inAHeader, ['another', publishedSecret])).resolves.toBe('proven');
    await expect(checkOf(presented, inAHeader, [])).resolves.toBe('mismatched');
  });

  it('checked under each of several secrets alone, none proving it, is refused as one check under them all refuses it', async () => {
    const outOfItsTime = `Bearer ${signedWith('HS256', { exp: nowSeconds - 300 })}`;
    const several = ['another subscription’s secret', publishedSecret];
    const alone = await Promise.all(several.map((secret) => checkOf(outOfItsTime, inAHeader, [secret])));

    expect(alone).toEqual(['mismatched', 'stale']);
    expect(refusalAmong(alone)).toBe(await checkOf(outOfItsTime, inAHeader, several));
  });

  it('is mismatched for claims changed by one byte, or a signature cut short', async () => {
    const [header = '', claims = '', signature = ''] = publishedToken.split('.');
    const changed = Buffer.from(claims, 'base64url');
    changed[10] = 0x32;

    await expect(
      checksOf([`${header}.${changed.toString('base64url')}.${signature}`, publishedToken.slice(0, -4)]),
    ).resolves.toEqual(['mismatched', 'mismatched']);
  });
});

describe('the times of a JSON Web Token', () => {
  it('are not required', async () => {
    await expect(checksOf([signedWith('HS256', {})])).resolves.toEqual(['proven']);
  });

  it('take an exp up to five minutes past, as they take a delivery’s time, and refuse it after', async () => {
    const tokens = [299, 300].map((seconds) => signedWith('HS256', { exp: nowSeconds - seconds }));

    await expect(checksOf(tokens)).resolves.toEqual(['proven', 'stale']);
  });

  it('take an nbf up to five minutes ahead, and refuse it beyond', async () => {
    const tokens = [300, 301].map((seconds) => signedWith('HS256', { nbf: nowSeconds + seconds }));

    await expect(checksOf(tokens)).resolves.toEqual(['proven', 'stale']);
  });

  it('are unsigned where they are not numbers, as RFC 7519 writes a NumericDate', async () => {
    const claimed: readonly Claims[] = [{ exp: String(nowSeconds) }, { nbf: 'soon' }, { iat: 'today' }];
    const tokens = claimed.map((claims) => signedWith('HS256', claims));

    await expect(checksOf(tokens)).resolves.toEqual(['unsigned', 'unsigned', 'unsigned']);
  });
});

describe('what a JSON Web Token presents that is not taken', () => {
  it('is unsigned without its prefix, with another, or with nothing after it', async () => {
    const presented = [publishedToken, `bearer ${publishedToken}`, 'Bearer '];
    const checks = await Promise.all(presented.map((token) => checkOf(token)));

    expect(checks).toEqual(['unsigned', 'unsigned', 'unsigned']);
  });

  it('is unsigned where it is no signed token of three parts', async () => {
    const [header = '', claims = ''] = publishedToken.split('.');
    const tokens = ['not-a-token', `${header}.${claims}`, `${header}.${claims}.!!`, `${publishedToken}.extra.part`];

    await expect(checksOf(tokens)).resolves.toEqual(['unsigned', 'unsigned', 'unsigned', 'unsigned']);
  });

  it('is unsigned where its claims are no JSON object, or it names an extension it must be understood by', async () => {
    const notAnObject = `${partOf({ alg: 'HS256' })}.${Buffer.from('"text"').toString('base64url')}`;
    const tokens = [
      `${notAnObject}.${createHmac('sha256', publishedSecret).update(notAnObject).digest('base64url')}`,
      tokenOf({ alg: 'HS256', crit: ['exp-at'], 'exp-at': 1 }, { sub: 'delivery' }),
    ];

    await expect(checksOf(tokens)).resolves.toEqual(['unsigned', 'unsigned']);
  });

  it('is unsigned where the entry declares no algorithm', async () => {
    await expect(checkOf(`Bearer ${publishedToken}`, { scheme: 'jwt', prefix: 'Bearer ' })).resolves.toBe('unsigned');
  });
});
