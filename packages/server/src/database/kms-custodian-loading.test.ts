import { createRequire } from 'node:module';

import { serveFakeKms } from '@on.auto/secrets/testing';
import { Effect, Logger } from 'effect';
import { afterAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { ledgerStoresOpenedBy } from './ledger-stores.ts';

const modulesLoaded = createRequire(import.meta.url).cache;

function modulesOfTheKmsClientLoaded(): readonly string[] {
  return Object.keys(modulesLoaded).filter((path) => path.includes('/@aws-sdk/client-kms/'));
}

const keyArn = `arn:aws:kms:eu-west-1:111122223333:key/${crypto.randomUUID()}`;

const fake = await serveFakeKms({ keys: [keyArn] });

afterAll(fake.close);

async function openedAndClosed(environment: Readonly<Record<string, string>>): Promise<void> {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(Logger.layer([]))));
  const stores = await ledgerStoresOpenedBy(context, readSettings({ LEDGER_FILE: fileName, ...environment }), {
    store: 'sqlite',
    file: fileName,
  });
  await stores.secrets.close();
}

describe('a server that opens its secret store under a key in hand', () => {
  it('loads no module of the client of KMS, from the environment or from the file beside the ledger', async () => {
    await openedAndClosed({ SECRETS_KEY: Buffer.alloc(32, 5).toString('base64') });
    await openedAndClosed({});

    expect(modulesOfTheKmsClientLoaded()).toEqual([]);
  });
});

describe('a server that opens its secret store under a key in KMS', () => {
  it('loads the client of KMS with the custodian of the aws subpath of the secrets package', async () => {
    vi.stubEnv('AWS_ENDPOINT_URL_KMS', fake.url);
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'an-access-key-of-the-tests');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'a-secret-access-key-of-the-tests');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    await openedAndClosed({ SECRETS_KEY_KMS: keyArn });

    expect(modulesOfTheKmsClientLoaded()).toContainEqual(expect.stringContaining('/@aws-sdk/client-kms/dist-cjs/'));
  });
});
