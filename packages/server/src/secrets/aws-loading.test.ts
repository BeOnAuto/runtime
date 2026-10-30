import { createRequire } from 'node:module';

import { serveFakeKms, serveFakeParameterStore } from '@on.auto/secrets/served-fakes';
import { Effect, Logger } from 'effect';
import { afterAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { ledgerStoresOpenedBy } from '../database/ledger-stores.ts';
import { sqliteLedgerDatabase } from '../database/sqlite-ledger-database.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

const modulesLoaded = createRequire(import.meta.url).cache;

function modulesOfTheClientLoaded(client: string): readonly string[] {
  return Object.keys(modulesLoaded).filter((path) => path.includes(`/@aws-sdk/${client}/`));
}

const keyArn = `arn:aws:kms:eu-west-1:111122223333:key/${crypto.randomUUID()}`;

const [kms, parameterStore] = [await serveFakeKms({ keys: [keyArn] }), await serveFakeParameterStore()];

afterAll(async () => {
  await kms.close();
  await parameterStore.close();
});

async function openedAndClosed(environment: Readonly<Record<string, string>>): Promise<void> {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(Logger.layer([]))));
  const stores = await ledgerStoresOpenedBy(
    context,
    readSettingsOf({ LEDGER_FILE: fileName, ...environment }),
    sqliteLedgerDatabase(fileName),
  );
  await stores.secrets.close();
}

function underTheFakes(): void {
  vi.stubEnv('AWS_ENDPOINT_URL_KMS', kms.url);
  vi.stubEnv('AWS_ENDPOINT_URL_SSM', parameterStore.url);
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'an-access-key-of-the-tests');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'a-secret-access-key-of-the-tests');
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}

describe('a server that opens its secret store under a key in hand, in the ledger', () => {
  it('loads no module of the client of KMS or of Parameter Store, from the environment or from the file beside the ledger', async () => {
    await openedAndClosed({ SECRETS_KEY: Buffer.alloc(32, 5).toString('base64') });
    await openedAndClosed({});

    expect([...modulesOfTheClientLoaded('client-kms'), ...modulesOfTheClientLoaded('client-ssm')]).toEqual([]);
  });
});

describe('a server that keeps its secrets in AWS Parameter Store', () => {
  it('loads the client of Parameter Store with the keeper of the aws subpath of the secrets package', async () => {
    underTheFakes();

    await openedAndClosed({ SECRETS_KEEPER: 'aws-parameter-store:/auto-runtime/secrets', AWS_REGION: 'eu-west-1' });

    expect(modulesOfTheClientLoaded('client-ssm')).toContainEqual(
      expect.stringContaining('/@aws-sdk/client-ssm/dist-cjs/'),
    );
    expect(parameterStore.calls().map(({ operation }) => operation)).toEqual([
      'PutParameter',
      'GetParameter',
      'DeleteParameter',
    ]);
  });
});

describe('a server that opens its secret store under a key in KMS', () => {
  it('loads the client of KMS with the custodian of the aws subpath of the secrets package', async () => {
    underTheFakes();

    await openedAndClosed({ SECRETS_KEY_KMS: keyArn });

    expect(modulesOfTheClientLoaded('client-kms')).toContainEqual(
      expect.stringContaining('/@aws-sdk/client-kms/dist-cjs/'),
    );
  });
});
