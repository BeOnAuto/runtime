import { existsSync } from 'node:fs';

import { sqliteSecretRows } from '@on.auto/ledger/sqlite3';
import {
  kmsCustodian,
  parameterStoreKeeper,
  type AwsWaits,
  type ParameterStoreKeeperOptions,
} from '@on.auto/secrets/aws';
import { serveFakeParameterStore, type FakeParameterOperation } from '@on.auto/secrets/testing';
import { Effect, Logger, Redacted, type Context } from 'effect';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { secretStoreInFile } from '../testing/records/kept-credentials.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { ledgerStoresOpenedBy, type LedgerStores } from './ledger-stores.ts';

const account = '111122223333';

const fake = await serveFakeParameterStore({ region: 'eu-west-1', account });

afterAll(fake.close);

const credentials = { accessKeyId: 'an-access-key-of-the-tests', secretAccessKey: 'a-secret-access-key-of-the-tests' };

const waitsOf100Ms: AwsWaits = { connectionMs: 100, requestMs: 100 };

function adaptersOn(url: string, waits?: AwsWaits) {
  return {
    kmsCustodian,
    parameterStoreKeeper: (options: ParameterStoreKeeperOptions) =>
      parameterStoreKeeper({ ...options, credentials, endpoint: url, waits }),
  };
}

const prefix = '/auto-runtime/secrets';

const inTheManager = { SECRETS_KEEPER: `aws-parameter-store:${prefix}`, AWS_REGION: 'eu-west-1' };

const keyInHand = Buffer.alloc(32, 4);

const inHand = keyInHand.toString('base64');

const valuesKept = ['pasted-key-1', 'pasted-key-2'];

async function aContextLogging(): Promise<{ readonly context: Context.Context<never>; readonly lines: string[] }> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(Logger.layer([capture]))));
  return { context, lines };
}

function aLedger(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

interface Opened {
  readonly stores: LedgerStores;
  readonly lines: readonly string[];
}

async function openedWith(
  fileName: string,
  environment: Readonly<Record<string, string>>,
  parameterStoreUrl = fake.url,
  waits?: AwsWaits,
): Promise<Opened> {
  const { context, lines } = await aContextLogging();
  const stores = await ledgerStoresOpenedBy(
    context,
    readSettings({ LEDGER_FILE: fileName, ...environment }),
    { store: 'sqlite', file: fileName },
    () => Promise.resolve(adaptersOn(parameterStoreUrl, waits)),
  );
  onTestFinished(() => stores.secrets.close());
  return { stores, lines };
}

function valueOf(stored: { readonly value: Redacted.Redacted } | undefined): string {
  return stored === undefined ? '' : Redacted.value(stored.value);
}

function secretsLineOf(lines: readonly string[]): string {
  return lines.filter((line) => line.includes('Secrets are kept')).join('\n');
}

async function heldIn(fileName: string) {
  const rows = await Effect.runPromise(sqliteSecretRows({ fileName }));
  const held = await Effect.runPromise(
    Effect.all([rows.heldBy({ keptBy: 'aws-parameter-store' }, 10), rows.heldBy({ keptBy: 'ledger' }, 10)]),
  );
  await rows.close();
  return held.flat();
}

async function keptUnderTheKeyInHand(fileName: string): Promise<readonly string[]> {
  const store = await secretStoreInFile(fileName, keyInHand);
  const ids = await Effect.runPromise(Effect.forEach(valuesKept, (value) => store.keep(Redacted.make(value))));
  await store.close();
  return ids;
}

describe('the stores of a ledger whose secrets AWS Parameter Store keeps', () => {
  it('probe the prefix at start with one parameter written, read and deleted, need no key and make no key file, keep each value there as it is and log where secrets are kept', async () => {
    const { fileName, directory } = aLedger();
    const before = fake.calls().length;

    const { stores, lines } = await openedWith(fileName, inTheManager);
    const probe = fake.calls().slice(before);
    const id = await Effect.runPromise(stores.secrets.keep(Redacted.make('pasted-key')));
    const read = await Effect.runPromise(stores.secrets.read(id));

    expect(probe.map(({ operation, answer }) => `${operation} ${answer}`)).toEqual([
      'PutParameter answered',
      'GetParameter answered',
      'DeleteParameter answered',
    ]);
    expect(new Set(probe.map(({ name }) => name)).size).toBe(1);
    expect(probe[0]?.name).toMatch(new RegExp(`^${prefix}/probe-[\\da-f-]{36}$`, 'u'));
    expect(fake.parameter(String(probe[0]?.name))).toBeUndefined();
    expect(secretsLineOf(lines)).toContain(
      `"message":"Secrets are kept in AWS Parameter Store under ${prefix} in eu-west-1, and 0 kept by the previous keeper were moved there"`,
    );
    expect(secretsLineOf(lines)).toContain(
      `"annotations":{"secrets_keeper":"aws-parameter-store","secrets_prefix":"${prefix}","secrets_region":"eu-west-1","secrets_moved":0}`,
    );
    expect(existsSync(`${directory}/secrets.key`)).toBe(false);
    expect(fake.parameter(`${prefix}/${id}`)).toEqual({ tier: 'Standard', versions: ['pasted-key'] });
    expect(await heldIn(fileName)).toEqual([
      { id, version: 1, holding: { keptBy: 'aws-parameter-store', held: `${prefix}/${id}:1` } },
    ]);
    expect(valueOf(read)).toBe('pasted-key');
  });
});

const denials: readonly (readonly [string, FakeParameterOperation])[] = [
  ['write', 'PutParameter'],
  ['read', 'GetParameter'],
  ['delete', 'DeleteParameter'],
];

const unprobed = `The secrets settings are invalid. SECRETS_KEEPER: AWS Parameter Store under ${prefix} could not write, read and delete a parameter at start: AWS Parameter Store could not`;

describe('the stores of a ledger whose prefix in AWS Parameter Store cannot be used', () => {
  it.each(denials)(
    'stop the start for a prefix the identity may not %s, naming the setting, the prefix and the words of the manager, never a credential or the account',
    async (act, operation) => {
      fake.tell('denied', [operation]);
      onTestFinished(() => {
        fake.tell('answering');
      });

      const opened = openedWith(aLedger().fileName, inTheManager);

      await expect(opened).rejects.toThrow(
        new RegExp(
          `^${unprobed} ${act} the parameter ${prefix}/probe-[\\da-f-]{36}(:1)?: AccessDeniedException: User: user/runtime is not authorized to perform: ssm:${operation} on resource: parameter${prefix}/probe-[\\da-f-]{36} because no identity-based policy allows the ssm:${operation} action$`,
          'u',
        ),
      );
      await expect(opened).rejects.not.toThrow(new RegExp(`${account}|${credentials.secretAccessKey}`, 'u'));
    },
  );

  it('stop the start for a manager that does not answer within the waits of 100 ms its client is given, the bound this test is about, naming the setting and the prefix', async () => {
    fake.tell('stalling', ['PutParameter']);
    onTestFinished(() => {
      fake.tell('answering');
    });

    await expect(openedWith(aLedger().fileName, inTheManager, fake.url, waitsOf100Ms)).rejects.toThrow(
      new RegExp(`^${unprobed} write the parameter ${prefix}/probe-[\\da-f-]{36}: TimeoutError`, 'u'),
    );
  });
});

const movingBack = {
  SECRETS_KEEPER: 'ledger',
  SECRETS_KEEPER_PREVIOUS: inTheManager.SECRETS_KEEPER,
  SECRETS_KEY: inHand,
  AWS_REGION: 'eu-west-1',
};

const movingThere = { ...inTheManager, SECRETS_KEEPER_PREVIOUS: 'ledger', SECRETS_KEY: inHand };

function movedIntoTheManager(fileName: string): Promise<Opened> {
  return openedWith(fileName, movingThere);
}

function credentialsAndKeysIn(lines: readonly string[]): readonly string[] {
  const logged = lines.join('\n');
  return [...valuesKept, inHand, credentials.accessKeyId, credentials.secretAccessKey].filter((secret) =>
    logged.includes(secret),
  );
}

describe('the move of the secrets between the ledger and AWS Parameter Store', () => {
  it('moves into the manager every secret the ledger seals, counting each, each value there as it is, and logs nothing of a value, a key or a credential', async () => {
    const { fileName } = aLedger();
    const ids = await keptUnderTheKeyInHand(fileName);

    const there = await movedIntoTheManager(fileName);

    expect(secretsLineOf(there.lines)).toContain(
      `Secrets are kept in AWS Parameter Store under ${prefix} in eu-west-1, and 2 kept by the previous keeper were moved there`,
    );
    expect((await heldIn(fileName)).map(({ holding }) => holding.keptBy)).toEqual([
      'aws-parameter-store',
      'aws-parameter-store',
    ]);
    expect(ids.map((id) => fake.parameter(`${prefix}/${id}`)?.versions)).toEqual([['pasted-key-1'], ['pasted-key-2']]);
    expect(credentialsAndKeysIn(there.lines)).toEqual([]);
  });

  it('moves them back into the ledger, counting each in the line of the ledger, deleting each parameter, and reads every secret back', async () => {
    const { fileName } = aLedger();
    const ids = await keptUnderTheKeyInHand(fileName);
    await movedIntoTheManager(fileName);

    const back = await openedWith(fileName, movingBack);
    const read = await Effect.runPromise(Effect.forEach(ids, (id) => back.stores.secrets.read(id)));

    expect(secretsLineOf(back.lines)).toMatch(
      /"message":"Secrets are kept in the ledger's database, sealed under the key [\da-f]{16} that SECRETS_KEY holds, and 0 sealed under the previous key were sealed again under it, and 2 kept by the previous keeper were moved there"/u,
    );
    expect((await heldIn(fileName)).map(({ holding }) => holding.keptBy)).toEqual(['ledger', 'ledger']);
    expect(ids.map((id) => fake.parameter(`${prefix}/${id}`))).toEqual([undefined, undefined]);
    expect(read.map((stored) => valueOf(stored))).toEqual(valuesKept);
    expect(credentialsAndKeysIn(back.lines)).toEqual([]);
  });
});

describe('the move of the secrets out of an AWS Parameter Store that cannot be read', () => {
  it('stops the start for secrets the previous keeper cannot reveal, naming SECRETS_KEEPER_PREVIOUS before the words of the manager', async () => {
    const { fileName } = aLedger();
    const { stores } = await openedWith(fileName, inTheManager);
    const id = await Effect.runPromise(stores.secrets.keep(Redacted.make('pasted-key')));
    fake.tell('denied', ['GetParameter']);
    onTestFinished(() => {
      fake.tell('answering');
    });

    const opened = openedWith(fileName, movingBack);

    await expect(opened).rejects.toThrow(
      `The secrets settings are invalid. SECRETS_KEEPER_PREVIOUS: The secrets its keeper keeps could not be moved to the keeper SECRETS_KEEPER names: AWS Parameter Store could not read the parameter ${prefix}/${id}:1: AccessDeniedException: User: user/runtime is not authorized to perform: ssm:GetParameter on resource: parameter${prefix}/${id} because no identity-based policy allows the ssm:GetParameter action`,
    );
  });
});

describe('the move of the secrets into an AWS Parameter Store whose account keeps no more parameters', () => {
  it('stops the start at the first secret past them, naming SECRETS_KEEPER_PREVIOUS before the words of the manager, the secrets moved before it staying moved', async () => {
    const full = await serveFakeParameterStore({ region: 'eu-west-1', account });
    onTestFinished(full.close);
    full.keepAtMost(1);
    const { fileName } = aLedger();
    const [first, second] = await keptUnderTheKeyInHand(fileName);

    const opened = openedWith(fileName, movingThere, full.url);

    await expect(opened).rejects.toThrow(
      `The secrets settings are invalid. SECRETS_KEEPER_PREVIOUS: The secrets its keeper keeps could not be moved to the keeper SECRETS_KEEPER names: AWS Parameter Store refused to keep the parameter ${prefix}/${String(second)}: ParameterLimitExceeded: The fake Parameter Store keeps no more parameters`,
    );
    expect((await heldIn(fileName)).map(({ id, holding }) => [id, holding.keptBy])).toEqual([
      [first, 'aws-parameter-store'],
      [second, 'ledger'],
    ]);
    expect(full.parameter(`${prefix}/${String(first)}`)?.versions).toEqual(['pasted-key-1']);
  });
});
