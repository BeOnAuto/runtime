import {
  CreateAliasCommand,
  CreateKeyCommand,
  DecryptCommand,
  KMSClient,
  UpdateAliasCommand,
} from '@aws-sdk/client-kms';
import { Effect, Option, Redacted } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { Custodian } from '../custodians/custodian.ts';
import { inMemoryEntry, kept, readBack, storeWith, type TestCustodians } from '../testing/secrets-entry.ts';
import { storeBehaviour } from '../testing/store-behaviour.ts';
import { kmsCustodian } from './kms-custodian.ts';

const server = process.env['SECRETS_TEST_KMS_URL'] ?? '';

const skipped = server === '';

const notice = skipped
  ? ', skipped: set SECRETS_TEST_KMS_URL to the URL of a server that answers the KMS API, with its credentials, such as http://access:secret@127.0.0.1:19760, to run it'
  : '';

const region = 'us-east-1';

interface ServerKms {
  readonly client: () => KMSClient;
  readonly custodianOf: (keyId: string) => Promise<Custodian>;
}

function serverKmsOf(url: string): ServerKms {
  const { origin, username, password } = new URL(url);
  const credentials = { accessKeyId: decodeURIComponent(username), secretAccessKey: decodeURIComponent(password) };
  const proxy = { enabled: false, environment: {} };
  const client = new KMSClient({ endpoint: origin, region, credentials });
  return {
    client: () => client,
    custodianOf: (keyId) => Effect.runPromise(kmsCustodian({ keyId, region, proxy, credentials, endpoint: origin })),
  };
}

interface MadeKey {
  readonly arn: string;
  readonly id: string;
}

async function aKeyMadeOn({ client }: ServerKms): Promise<MadeKey> {
  const { KeyMetadata } = await client().send(new CreateKeyCommand({ Description: 'A key of the tests of secrets' }));
  const made = Option.getOrThrow(Option.fromNullishOr(KeyMetadata));
  return { arn: String(made.Arn), id: String(made.KeyId) };
}

function aDataKey(): Redacted.Redacted<Uint8Array> {
  return Redacted.make(crypto.getRandomValues(new Uint8Array(32)));
}

function onTheServer(): TestCustodians {
  return {
    aCustodian: async () => {
      const kms = serverKmsOf(server);
      return kms.custodianOf((await aKeyMadeOn(kms)).arn);
    },
  };
}

describe.skipIf(skipped)(
  `The custodian of an alias in a server that answers the KMS API${notice}`,
  { timeout: 120_000 },
  () => {
    it('resolves an alias to the key it names, and reads under the next key once the alias names it and the key before is the previous one', async () => {
      const kms = serverKmsOf(server);
      const [first, next] = [await aKeyMadeOn(kms), await aKeyMadeOn(kms)];
      const aliasName = `alias/secrets-test-${crypto.randomUUID()}`;
      const aliasArn = first.arn.replace(/key\/.+$/u, aliasName);
      await kms.client().send(new CreateAliasCommand({ AliasName: aliasName, TargetKeyId: first.id }));
      const entry = inMemoryEntry();
      const database = await entry.aDatabase();
      const sealing = await kms.custodianOf(aliasArn);
      const id = await kept(await storeWith(entry, database, { current: sealing }), 'pasted-key');

      await kms.client().send(new UpdateAliasCommand({ AliasName: aliasName, TargetKeyId: next.id }));
      const current = await kms.custodianOf(aliasArn);
      const previous = await kms.custodianOf(first.arn);
      const rewrapped = await Effect.runPromise((await storeWith(entry, database, { current, previous })).rotated());

      expect([sealing.kid, current.kid, rewrapped]).toEqual([first.id, next.id, 1]);
      expect(await readBack(await storeWith(entry, database, { current }), id)).toBe('pasted-key');
    });
  },
);

describe.skipIf(skipped)(
  `The secret store over keys in a server that answers the KMS API${notice}`,
  { timeout: 120_000 },
  () => {
    const warned = vi.spyOn(console, 'warn');

    storeBehaviour(inMemoryEntry(), onTheServer());

    it('is refused under a key the server does not know, in the words of the server naming the kid and never the account', async () => {
      const unknown = await serverKmsOf(server).custodianOf(
        `arn:aws:kms:${region}:123456789012:key/${crypto.randomUUID()}`,
      );

      const refused = await Effect.runPromise(Effect.flip(unknown.wrap(aDataKey())));

      expect(refused).toMatchObject({ _tag: 'custodian_refused', kid: unknown.kid });
      expect(refused.detail).toMatch(
        new RegExp(`^The custodian of the key ${unknown.kid} refused to wrap a data key: NotFoundException: `, 'u'),
      );
      expect(refused.detail).not.toMatch(/\d{12}:/u);
    });

    it('binds each data key to the context that names the purpose, which the server opens under no other context', async () => {
      const kms = serverKmsOf(server);
      const { arn } = await aKeyMadeOn(kms);
      const dataKey = aDataKey();

      const custodian = await kms.custodianOf(arn);
      const wrapped = await Effect.runPromise(custodian.wrap(dataKey));
      const unwrapped = await Effect.runPromise(custodian.unwrap(wrapped));
      const elsewhere = new DecryptCommand({ KeyId: arn, CiphertextBlob: Buffer.from(wrapped, 'base64') });

      expect(Buffer.from(Redacted.value(unwrapped)).equals(Buffer.from(Redacted.value(dataKey)))).toBe(true);
      await expect(kms.client().send(elsewhere)).rejects.toMatchObject({ name: 'InvalidCiphertextException' });
    });

    it('writes nothing to console.warn from the SDK while it wraps and unwraps', () => {
      expect(warned).not.toHaveBeenCalled();
    });
  },
);
