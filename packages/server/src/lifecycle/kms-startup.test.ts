import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { sqliteSecretRows } from '@on.auto/ledger/sqlite3';
import { kmsCustodian } from '@on.auto/secrets/aws';
import { serveFakeKms } from '@on.auto/secrets/testing';
import { Effect, Redacted } from 'effect';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { spawnServer } from '../testing/processes/spawned-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const keyId = randomUUID();

const keyArn = `arn:aws:kms:eu-west-1:111122223333:key/${keyId}`;

const fake = await serveFakeKms({ keys: [keyArn] });

afterAll(fake.close);

const credentials = { accessKeyId: 'an-access-key-of-the-tests', secretAccessKey: 'a-secret-access-key-of-the-tests' };

function aLedgerFile(): string {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  return fileName;
}

function underTheKeyInKms(fileName: string): Readonly<Record<string, string>> {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: fileName,
    SECRETS_KEY_KMS: keyArn,
    AWS_ENDPOINT_URL_KMS: fake.url,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
  };
}

async function startedOnce(fileName: string): Promise<string> {
  const child = spawnServer(mainModule, underTheKeyInKms(fileName));
  await child.port;
  child.signal('SIGTERM');
  await child.exited;
  return child.output().stderr;
}

async function dataKeysIn(fileName: string): Promise<readonly string[]> {
  const rows = await Effect.runPromise(sqliteSecretRows({ fileName }));
  const held = await Effect.runPromise(rows.heldBy({ keptBy: 'ledger' }, 10));
  await rows.close();
  const proxy = { enabled: false, environment: {} };
  const custodian = await Effect.runPromise(
    kmsCustodian({ keyId: keyArn, region: 'eu-west-1', proxy, credentials, endpoint: fake.url }),
  );
  const dataKeys = await Effect.runPromise(
    Effect.forEach(held, ({ holding }) => custodian.unwrap(String(holding.wrappedKey))),
  );
  return dataKeys.flatMap((dataKey) => {
    const bytes = Buffer.from(Redacted.value(dataKey));
    return [bytes.toString('base64'), bytes.toString('hex')];
  });
}

describe('a server whose secrets a key in KMS holds, as it starts', () => {
  it('logs the KMS key its secrets are sealed under, at each start, and nothing of a data key or a credential', async () => {
    const fileName = aLedgerFile();
    const first = await startedOnce(fileName);
    const next = await startedOnce(fileName);
    const dataKeys = await dataKeysIn(fileName);
    const stderr = `${first}\n${next}`;

    expect(stderr.split('\n').filter((line) => line.includes('Secrets are kept'))).toEqual([
      expect.stringContaining(
        `"message":"Secrets are kept in the ledger's database, sealed under the key ${keyId} that the KMS key ${keyArn} holds, and 0 sealed under the previous key were sealed again under it"`,
      ),
      expect.stringContaining(`that the KMS key ${keyArn} holds, and 0 sealed`),
    ]);
    expect(dataKeys.length).toBeGreaterThan(0);
    expect(
      [credentials.accessKeyId, credentials.secretAccessKey, ...dataKeys].filter((secret) => stderr.includes(secret)),
    ).toEqual([]);
  });

  it('stops the process at start for a key that is disabled, naming the setting, the key and the words of KMS', async () => {
    fake.tell(keyArn, 'disabled');
    onTestFinished(() => {
      fake.tell(keyArn, 'enabled');
    });
    const child = spawnServer(mainModule, underTheKeyInKms(aLedgerFile()));

    const exitCode = await child.exited;

    expect(exitCode).toBe(1);
    expect(child.output().stderr.split('\n').slice(-2)).toEqual([
      `Auto Runtime could not start: InvalidSettingsError: The secrets settings are invalid. SECRETS_KEY_KMS: The KMS key ${keyId} it names could not wrap and unwrap a data key at start: The custodian of the key ${keyId} refused to wrap a data key: DisabledException: key/${keyId} is disabled.`,
      '',
    ]);
  });
});
