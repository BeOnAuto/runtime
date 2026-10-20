import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { Effect, Redacted, Schema } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import type { Custodian } from '../custodians/custodian.ts';
import type { KeepingFailure } from '../keepers/keeper.ts';
import { serveFakeKms, type FakeKeyState } from '../testing/fake-kms.ts';
import { encryptionContext, kidOfKey, kmsCustodian, type KmsWaits } from './kms-custodian.ts';

const account = '111122223333';

function aKeyArn(): string {
  return `arn:aws:kms:eu-west-1:${account}:key/${randomUUID()}`;
}

function anAliasArn(name: string): string {
  return `arn:aws:kms:eu-west-1:${account}:alias/${name}`;
}

const [key, otherKey, unknownKey, aliasedKey, nextKey] = [aKeyArn(), aKeyArn(), aKeyArn(), aKeyArn(), aKeyArn()];

const [alias, movingAlias, unknownAlias] = [
  anAliasArn('auto-runtime'),
  anAliasArn('team/auto-runtime'),
  anAliasArn('unknown'),
];

const fake = await serveFakeKms({
  keys: [key, otherKey, aliasedKey, nextKey],
  aliases: { [alias]: aliasedKey, [movingAlias]: aliasedKey },
});

afterAll(fake.close);

const credentials = { accessKeyId: 'an-access-key', secretAccessKey: 'a-secret-access-key' };

const noProxy = { enabled: false, environment: {} };

function madeOf(keyId: string, endpoint = fake.url, waits?: KmsWaits): Effect.Effect<Custodian, KeepingFailure> {
  return kmsCustodian({ keyId, region: 'eu-west-1', proxy: noProxy, credentials, endpoint, waits });
}

function custodianOf(keyId: string, endpoint = fake.url, waits?: KmsWaits): Promise<Custodian> {
  return Effect.runPromise(madeOf(keyId, endpoint, waits));
}

function aDataKey(): Redacted.Redacted<Uint8Array> {
  return Redacted.make(crypto.getRandomValues(new Uint8Array(32)));
}

function failureOf<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

async function aClosedPort(): Promise<string> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = decodeAddress(server.address());
  server.close();
  await once(server, 'close');
  return `http://127.0.0.1:${String(port)}`;
}

function idOf(arn: string): string {
  return arn.slice(arn.lastIndexOf('/') + 1);
}

const waitsOf100Ms: KmsWaits = { connectionMs: 100, requestMs: 100 };

describe('the custodian of a key in KMS', () => {
  it('is named by the id of the key its ARN names, and is made without reaching anything', async () => {
    const made = await Effect.runPromise(
      kmsCustodian({ keyId: key, region: 'eu-west-1', proxy: noProxy, credentials }),
    );

    expect([made.kid, kidOfKey(key), kidOfKey(idOf(key))]).toEqual([idOf(key), idOf(key), idOf(key)]);
  });

  it('wraps a data key with Encrypt under its key and the context that names the purpose, as base64 that holds no data key, and unwraps it with Decrypt under the same key and context', async () => {
    const custodian = await custodianOf(key);
    const dataKey = aDataKey();
    const before = fake.calls().length;

    const wrapped = await Effect.runPromise(custodian.wrap(dataKey));
    const unwrapped = await Effect.runPromise(custodian.unwrap(wrapped));

    const bytes = Buffer.from(Redacted.value(dataKey));
    expect(Buffer.from(Redacted.value(unwrapped)).equals(bytes)).toBe(true);
    expect(Buffer.from(wrapped, 'base64').toString('base64')).toBe(wrapped);
    expect([wrapped.includes(bytes.toString('base64')), Buffer.from(wrapped, 'base64').includes(bytes)]).toEqual([
      false,
      false,
    ]);
    expect(fake.calls().slice(before)).toEqual([
      { operation: 'Encrypt', keyId: key, context: { 'on.auto/runtime': 'secret data key' } },
      { operation: 'Decrypt', keyId: key, context: encryptionContext },
    ]);
  });
});

describe('the custodian of a key that an alias names', () => {
  it('asks DescribeKey once as it is made, is named by the id of the key the alias names, and pins that key, never the alias, on Encrypt and Decrypt', async () => {
    const before = fake.calls().length;

    const custodian = await custodianOf(alias);
    const wrapped = await Effect.runPromise(custodian.wrap(aDataKey()));
    await Effect.runPromise(custodian.unwrap(wrapped));

    expect(custodian.kid).toBe(idOf(aliasedKey));
    expect(fake.calls().slice(before)).toEqual([
      { operation: 'DescribeKey', keyId: alias },
      { operation: 'Encrypt', keyId: aliasedKey, context: encryptionContext },
      { operation: 'Decrypt', keyId: aliasedKey, context: encryptionContext },
    ]);
  });

  it('is a custodian of another key once the alias is pointed at another, and what the key it named before wrapped opens under that key alone', async () => {
    const before = await custodianOf(movingAlias);
    const wrapped = await Effect.runPromise(before.wrap(aDataKey()));

    fake.point(movingAlias, nextKey);
    const after = await custodianOf(movingAlias);
    const refused = await failureOf(after.unwrap(wrapped));
    const opened = await Effect.runPromise((await custodianOf(aliasedKey)).unwrap(wrapped));

    expect([before.kid, after.kid]).toEqual([idOf(aliasedKey), idOf(nextKey)]);
    expect(refused).toMatchObject({ _tag: 'custodian_refused', kid: idOf(nextKey) });
    expect(Redacted.value(opened)).toHaveLength(32);
  });
});

describe('the custodian of an alias KMS does not describe', () => {
  it('is not made under an alias KMS does not know, or whose key the identity may not describe, in the words of KMS without the account', async () => {
    const unknown = await failureOf(madeOf(unknownAlias));
    fake.tell(aliasedKey, 'denied');
    const denied = await failureOf(madeOf(alias));
    fake.tell(aliasedKey, 'enabled');

    expect([unknown, denied]).toMatchObject([
      {
        _tag: 'custodian_refused',
        kid: 'alias/unknown',
        detail:
          'The custodian of the alias alias/unknown refused to describe the key it names: NotFoundException: Alias alias/unknown is not found.',
      },
      {
        _tag: 'custodian_refused',
        kid: 'alias/auto-runtime',
        detail: `The custodian of the alias alias/auto-runtime refused to describe the key it names: AccessDeniedException: User: user/runtime is not authorized to perform: kms:DescribeKey on resource: key/${idOf(aliasedKey)} because no identity-based policy allows the kms:DescribeKey action`,
      },
    ]);
    expect(JSON.stringify([unknown, denied])).not.toContain(account);
  });

  it('is not made where KMS does not answer DescribeKey within the waits of its client, as a keeper that does not answer, naming the alias', async () => {
    fake.tell(aliasedKey, 'stalling');

    const stalled = await failureOf(madeOf(alias, fake.url, waitsOf100Ms));
    fake.tell(aliasedKey, 'enabled');

    expect(stalled).toMatchObject({ _tag: 'keeper_unavailable', kid: 'alias/auto-runtime' });
    expect(stalled.detail).toMatch(
      /^The custodian of the alias alias\/auto-runtime did not answer a request to describe the key it names: TimeoutError/u,
    );
  });
});

const refusals: readonly (readonly [FakeKeyState, string])[] = [
  ['disabled', `DisabledException: key/${idOf(key)} is disabled.`],
  ['pending_deletion', `KMSInvalidStateException: key/${idOf(key)} is pending deletion.`],
  [
    'denied',
    `AccessDeniedException: User: user/runtime is not authorized to perform: kms:Encrypt on resource: key/${idOf(key)} because no identity-based policy allows the kms:Encrypt action`,
  ],
];

describe('the custodian of a key KMS will not use', () => {
  it.each(refusals)(
    'refuses to wrap under a key %s in the words of KMS, naming its kid and never the account or a credential',
    async (state, words) => {
      const custodian = await custodianOf(key);
      fake.tell(key, state);

      const refused = await failureOf(custodian.wrap(aDataKey()));
      fake.tell(key, 'enabled');

      expect(refused).toMatchObject({
        _tag: 'custodian_refused',
        kid: idOf(key),
        detail: `The custodian of the key ${idOf(key)} refused to wrap a data key: ${words}`,
      });
      expect(JSON.stringify(refused)).not.toMatch(new RegExp(`${account}|${credentials.secretAccessKey}`, 'u'));
    },
  );

  it('refuses a key KMS does not know, and unwraps nothing it did not wrap under that key and context', async () => {
    const wrapped = await Effect.runPromise((await custodianOf(otherKey)).wrap(aDataKey()));
    const custodian = await custodianOf(key);

    const [unknown, ofAnother, unmade] = [
      await failureOf((await custodianOf(unknownKey)).wrap(aDataKey())),
      await failureOf(custodian.unwrap(wrapped)),
      await failureOf(custodian.unwrap(Buffer.from('not a ciphertext').toString('base64'))),
    ];

    expect([unknown, ofAnother, unmade]).toMatchObject([
      {
        _tag: 'custodian_refused',
        detail: `The custodian of the key ${idOf(unknownKey)} refused to wrap a data key: NotFoundException: Key 'key/${idOf(unknownKey)}' does not exist`,
      },
      {
        _tag: 'custodian_refused',
        detail: `The custodian of the key ${idOf(key)} refused to unwrap a data key: IncorrectKeyException: The key in the request is not the key that encrypted the ciphertext`,
      },
      {
        _tag: 'custodian_refused',
        detail: `The custodian of the key ${idOf(key)} refused to unwrap a data key: InvalidCiphertextException: The ciphertext is not one this KMS made`,
      },
    ]);
  });
});

const throttlings: readonly (readonly [string, number])[] = [
  ['ThrottlingException', 400],
  ['LimitExceededException', 400],
  ['TooManyRequestsException', 429],
];

describe('the custodian of a key in a KMS that throttles it', () => {
  it.each(throttlings)(
    'does not answer now, for %s answered with HTTP %i, as a keeper that does not answer, naming its kid',
    async (type, status) => {
      const custodian = await custodianOf(key);
      fake.failWith(key, { type, status });

      const throttled = await failureOf(custodian.wrap(aDataKey()));
      fake.tell(key, 'enabled');

      expect(throttled).toMatchObject({
        _tag: 'keeper_unavailable',
        kid: idOf(key),
        detail: `The custodian of the key ${idOf(key)} did not answer a request to wrap a data key: ${type}: Rate exceeded`,
      });
    },
  );
});

describe('the custodian of a key in a KMS that does not answer', () => {
  it('gives up within the waits of its client, where KMS stalls and where it cannot be reached, as a keeper that does not answer, naming its kid', async () => {
    const stalling = await custodianOf(key, fake.url, waitsOf100Ms);
    const unreachable = await custodianOf(key, await aClosedPort(), waitsOf100Ms);
    fake.tell(key, 'stalling');
    const started = performance.now();

    const stalled = await failureOf(stalling.wrap(aDataKey()));
    const unreached = await failureOf(unreachable.unwrap('d3JhcHBlZA=='));
    fake.tell(key, 'enabled');

    expect([stalled, unreached]).toMatchObject([
      { _tag: 'keeper_unavailable', kid: idOf(key) },
      { _tag: 'keeper_unavailable', kid: idOf(key) },
    ]);
    expect(stalled.detail).toMatch(
      new RegExp(
        `^The custodian of the key ${idOf(key)} did not answer a request to wrap a data key: TimeoutError`,
        'u',
      ),
    );
    expect(unreached.detail).toMatch(/did not answer a request to unwrap a data key: .*ECONNREFUSED/u);
    expect(performance.now() - started).toBeLessThan(20_000);
  });
});
