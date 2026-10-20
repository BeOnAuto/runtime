import { sqliteSecretRows } from '@on.auto/ledger/sqlite3';
import { sha256Of } from '@on.auto/operations';
import { kmsCustodian, type KmsCustodianOptions } from '@on.auto/secrets/aws';
import { serveFakeKms, type FakeKeyState } from '@on.auto/secrets/testing';
import { Effect, Logger, Redacted, type Context } from 'effect';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { secretStoreInFile } from '../testing/records/kept-credentials.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { ledgerStoresOpenedBy } from './ledger-stores.ts';

const account = '111122223333';

const keyId = 'a2e5c1f4-6b0d-4c3e-9f21-7d8e6b5a4c3f';

const keyArn = `arn:aws:kms:eu-west-1:${account}:key/${keyId}`;

const nextKeyId = '5b7f3d1e-8c2a-4e6b-a0d9-1f3e5c7a9b2d';

const nextKeyArn = `arn:aws:kms:eu-west-1:${account}:key/${nextKeyId}`;

const aliasArn = `arn:aws:kms:eu-west-1:${account}:alias/auto-runtime`;

const movingAliasArn = `arn:aws:kms:eu-west-1:${account}:alias/team/auto-runtime`;

const fake = await serveFakeKms({
  keys: [keyArn, nextKeyArn],
  aliases: { [aliasArn]: keyArn, [movingAliasArn]: keyArn },
});

afterAll(fake.close);

const credentials = { accessKeyId: 'an-access-key-of-the-tests', secretAccessKey: 'a-secret-access-key-of-the-tests' };

const onTheFake = {
  kmsCustodian: (options: KmsCustodianOptions) =>
    kmsCustodian({ ...options, credentials, endpoint: fake.url, waits: { connectionMs: 100, requestMs: 100 } }),
};

const keyInHand = Buffer.alloc(32, 4);

async function aContextLogging(): Promise<{ readonly context: Context.Context<never>; readonly lines: string[] }> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(Logger.layer([capture]))));
  return { context, lines };
}

function aLedgerFile(): string {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  return fileName;
}

async function openedWith(fileName: string, environment: Readonly<Record<string, string>>) {
  const { context, lines } = await aContextLogging();
  const stores = await ledgerStoresOpenedBy(
    context,
    readSettings({ LEDGER_FILE: fileName, ...environment }),
    { store: 'sqlite', file: fileName },
    () => Promise.resolve(onTheFake),
  );
  await stores.secrets.close();
  return lines;
}

async function storesOf(fileName: string, environment: Readonly<Record<string, string>>) {
  const { context } = await aContextLogging();
  return ledgerStoresOpenedBy(
    context,
    readSettings({ LEDGER_FILE: fileName, ...environment }),
    { store: 'sqlite', file: fileName },
    () => Promise.resolve(onTheFake),
  );
}

async function keptUnder(fileName: string, environment: Readonly<Record<string, string>>) {
  const { secrets } = await storesOf(fileName, environment);
  const ids = await Effect.runPromise(
    Effect.forEach(['pasted-key-1', 'pasted-key-2'], (value) => secrets.keep(Redacted.make(value))),
  );
  await secrets.close();
  return ids;
}

async function readUnder(fileName: string, environment: Readonly<Record<string, string>>, ids: readonly string[]) {
  const { secrets } = await storesOf(fileName, environment);
  const read = await Effect.runPromise(Effect.forEach(ids, (id) => secrets.read(id)));
  await secrets.close();
  return read.map((stored) => (stored === undefined ? '' : Redacted.value(stored.value)));
}

function secretsLineOf(lines: readonly string[]): string {
  return lines.filter((line) => line.includes('Secrets are kept')).join('\n');
}

describe('the stores of a ledger whose secrets a key in KMS holds', () => {
  it('probe the key at start with one data key under the context of the purpose, before anything is read, and log the KMS key', async () => {
    const before = fake.calls().length;

    const lines = await openedWith(aLedgerFile(), { SECRETS_KEY_KMS: keyArn });

    expect(fake.calls().slice(before)).toEqual([
      { operation: 'Encrypt', keyId: keyArn, context: { 'on.auto/runtime': 'secret data key' } },
      { operation: 'Decrypt', keyId: keyArn, context: { 'on.auto/runtime': 'secret data key' } },
    ]);
    expect(secretsLineOf(lines)).toContain(
      `"message":"Secrets are kept in the ledger's database, sealed under the key ${keyId} that the KMS key ${keyArn} holds, and 0 sealed under the previous key were sealed again under it"`,
    );
    expect(secretsLineOf(lines)).toContain(
      `"annotations":{"secrets_kid":"${keyId}","secrets_resealed":0,"secrets_key_from":"kms"}`,
    );
  });
});

const refusals: readonly (readonly [FakeKeyState, string])[] = [
  ['disabled', `DisabledException: key/${keyId} is disabled.`],
  ['pending_deletion', `KMSInvalidStateException: key/${keyId} is pending deletion.`],
  [
    'denied',
    `AccessDeniedException: User: user/runtime is not authorized to perform: kms:Encrypt on resource: key/${keyId} because no identity-based policy allows the kms:Encrypt action`,
  ],
];

const unprobed = `The secrets settings are invalid. SECRETS_KEY_KMS: The KMS key ${keyId} it names could not wrap and unwrap a data key at start`;

describe('the stores of a ledger whose key in KMS cannot be used', () => {
  it.each(refusals)(
    'stop the start for a key %s, naming the setting, the key and the words of KMS, and never a credential or the account',
    async (state, words) => {
      fake.tell(keyArn, state);
      onTestFinished(() => {
        fake.tell(keyArn, 'enabled');
      });

      const opened = openedWith(aLedgerFile(), { SECRETS_KEY_KMS: keyArn });

      await expect(opened).rejects.toThrow(
        `${unprobed}: The custodian of the key ${keyId} refused to wrap a data key: ${words}`,
      );
      await expect(opened).rejects.not.toThrow(new RegExp(`${account}|${credentials.secretAccessKey}`, 'u'));
    },
  );

  it('stop the start for a key KMS does not know, naming the setting, the key and the words of KMS', async () => {
    const unknownId = 'c0ffee00-1234-4abc-9def-0123456789ab';
    const unknownArn = `arn:aws:kms:eu-west-1:${account}:key/${unknownId}`;

    await expect(openedWith(aLedgerFile(), { SECRETS_KEY_KMS: unknownArn })).rejects.toThrow(
      `The secrets settings are invalid. SECRETS_KEY_KMS: The KMS key ${unknownId} it names could not wrap and unwrap a data key at start: The custodian of the key ${unknownId} refused to wrap a data key: NotFoundException: Key 'key/${unknownId}' does not exist`,
    );
  });

  it('stop the start for a key in a KMS that does not answer, naming the setting and the key', async () => {
    fake.tell(keyArn, 'stalling');
    onTestFinished(() => {
      fake.tell(keyArn, 'enabled');
    });

    await expect(openedWith(aLedgerFile(), { SECRETS_KEY_KMS: keyArn })).rejects.toThrow(
      `${unprobed}: The custodian of the key ${keyId} did not answer a request to wrap a data key: TimeoutError`,
    );
  });
});

async function keptUnderTheKeyInHand(fileName: string): Promise<void> {
  const store = await secretStoreInFile(fileName, keyInHand);
  await Effect.runPromise(
    Effect.forEach(['pasted-key-1', 'pasted-key-2'], (value) => store.keep(Redacted.make(value))),
  );
  await store.close();
}

async function valuesReadUnderTheKeyInHand(fileName: string, ids: readonly string[]): Promise<readonly string[]> {
  const store = await secretStoreInFile(fileName, keyInHand);
  const read = await Effect.runPromise(Effect.forEach(ids, (id) => store.read(id)));
  await store.close();
  return read.map((stored) => (stored === undefined ? '' : Redacted.value(stored.value)));
}

async function keptRowsIn(fileName: string) {
  const rows = await Effect.runPromise(sqliteSecretRows({ fileName }));
  const held = await Effect.runPromise(rows.heldBy({ keptBy: 'ledger' }, 10));
  await rows.close();
  return held;
}

async function dataKeysIn(fileName: string): Promise<readonly string[]> {
  const custodian = await Effect.runPromise(
    onTheFake.kmsCustodian({
      keyId: keyArn,
      region: 'eu-west-1',
      proxy: { enabled: false, environment: {} },
      credentials,
    }),
  );
  const held = await keptRowsIn(fileName);
  const dataKeys = await Effect.runPromise(
    Effect.forEach(held, ({ holding }) => custodian.unwrap(String(holding.wrappedKey))),
  );
  return dataKeys.flatMap((dataKey) => {
    const bytes = Buffer.from(Redacted.value(dataKey));
    return [bytes.toString('base64'), bytes.toString('hex')];
  });
}

describe('the rotation of the secrets between a key in hand and a key in KMS', () => {
  it('wraps again under the key in KMS what the key in hand wrapped, and back, counting each, and logs nothing of a key, a data key or a credential', async () => {
    const fileName = aLedgerFile();
    await keptUnderTheKeyInHand(fileName);
    const inHand = keyInHand.toString('base64');

    const intoKms = await openedWith(fileName, { SECRETS_KEY_KMS: keyArn, SECRETS_KEY_PREVIOUS: inHand });
    const kidsInKms = (await keptRowsIn(fileName)).map(({ holding }) => holding.kid);
    const dataKeys = await dataKeysIn(fileName);
    const back = await openedWith(fileName, { SECRETS_KEY: inHand, SECRETS_KEY_KMS_PREVIOUS: keyArn });
    const readBack = await valuesReadUnderTheKeyInHand(
      fileName,
      (await keptRowsIn(fileName)).map(({ id }) => id),
    );

    expect(secretsLineOf(intoKms)).toContain(`that the KMS key ${keyArn} holds, and 2 sealed under the previous key`);
    expect(kidsInKms).toEqual([keyId, keyId]);
    expect(secretsLineOf(back)).toContain(
      `sealed under the key ${sha256Of(keyInHand).slice(0, 16)} that SECRETS_KEY holds, and 2 sealed under the previous key`,
    );
    expect(readBack).toEqual(['pasted-key-1', 'pasted-key-2']);
    const logged = [...intoKms, ...back].join('\n');
    expect(
      [inHand, credentials.secretAccessKey, credentials.accessKeyId, ...dataKeys].filter((secret) =>
        logged.includes(secret),
      ),
    ).toEqual([]);
  });
});

describe('the stores of a ledger whose secrets the key behind an alias holds', () => {
  it('resolve the alias with DescribeKey before the probe, which then pins the key, and log the id of that key', async () => {
    const before = fake.calls().length;

    const lines = await openedWith(aLedgerFile(), { SECRETS_KEY_KMS: aliasArn });

    expect(fake.calls().slice(before)).toEqual([
      { operation: 'DescribeKey', keyId: aliasArn },
      { operation: 'Encrypt', keyId: keyArn, context: { 'on.auto/runtime': 'secret data key' } },
      { operation: 'Decrypt', keyId: keyArn, context: { 'on.auto/runtime': 'secret data key' } },
    ]);
    expect(secretsLineOf(lines)).toContain(`sealed under the key ${keyId} that the KMS key ${aliasArn} holds`);
  });

  it('stop the start for an alias KMS does not know, naming the setting, the alias and the words of KMS, never the account', async () => {
    const unknownAlias = `arn:aws:kms:eu-west-1:${account}:alias/unknown`;

    const opened = openedWith(aLedgerFile(), { SECRETS_KEY_KMS: unknownAlias });

    await expect(opened).rejects.toThrow(
      'The secrets settings are invalid. SECRETS_KEY_KMS: The KMS alias alias/unknown it names could not be resolved to its key at start: The custodian of the alias alias/unknown refused to describe the key it names: NotFoundException: Alias alias/unknown is not found.',
    );
    await expect(opened).rejects.not.toThrow(new RegExp(account, 'u'));
  });
});

describe('the stores of a ledger whose alias is pointed at another key', () => {
  it('wrap again under the key the alias names now what the key before wrapped, given as the previous one, and read every secret back', async () => {
    const fileName = aLedgerFile();
    const ids = await keptUnder(fileName, { SECRETS_KEY_KMS: movingAliasArn });
    fake.point(movingAliasArn, nextKeyArn);

    const moved = await openedWith(fileName, { SECRETS_KEY_KMS: movingAliasArn, SECRETS_KEY_KMS_PREVIOUS: keyArn });
    const kids = (await keptRowsIn(fileName)).map(({ holding }) => holding.kid);
    const values = await readUnder(fileName, { SECRETS_KEY_KMS: movingAliasArn }, ids);

    expect(secretsLineOf(moved)).toContain(
      `sealed under the key ${nextKeyId} that the KMS key ${movingAliasArn} holds, and 2 sealed under the previous key`,
    );
    expect(kids).toEqual([nextKeyId, nextKeyId]);
    expect(values).toEqual(['pasted-key-1', 'pasted-key-2']);
  });
});
