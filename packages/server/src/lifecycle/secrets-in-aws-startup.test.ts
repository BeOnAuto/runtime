import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sqliteSecretRows } from '@on.auto/ledger/sqlite3';
import { kmsCustodian } from '@on.auto/secrets/aws';
import { serveFakeKms, serveFakeParameterStore } from '@on.auto/secrets/served-fakes';
import { Effect, Redacted } from 'effect';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { spawnServer } from '../testing/processes/spawned-server.ts';
import { ownKeyFactsIn } from '../testing/records/kept-credentials.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const keyId = crypto.randomUUID();

const keyArn = `arn:aws:kms:eu-west-1:111122223333:key/${keyId}`;

const fake = await serveFakeKms({ keys: [keyArn] });

const parameterStore = await serveFakeParameterStore();

const elsewhere = await serveFakeParameterStore({ region: 'eu-north-1' });

afterAll(async () => {
  await fake.close();
  await parameterStore.close();
  await elsewhere.close();
});

const page = readFileSync(new URL('../../../../docs/self-host/secret-manager.md', import.meta.url), 'utf8');

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

const prefix = '/auto-runtime/secrets';

function inTheManager(fileName: string): Readonly<Record<string, string>> {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: fileName,
    SECRETS_KEEPER: `aws-parameter-store:${prefix}`,
    AWS_REGION: 'eu-west-1',
    AWS_ENDPOINT_URL_SSM: parameterStore.url,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
  };
}

async function startedUnder(environment: Readonly<Record<string, string>>): Promise<string> {
  const child = spawnServer(mainModule, environment);
  await child.port;
  child.signal('SIGTERM');
  await child.exited;
  return child.output().stderr;
}

function startedOnce(fileName: string): Promise<string> {
  return startedUnder(underTheKeyInKms(fileName));
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

async function heldInTheManager(fileName: string) {
  const rows = await Effect.runPromise(sqliteSecretRows({ fileName }));
  const held = await Effect.runPromise(rows.heldBy({ keptBy: 'aws-parameter-store' }, 10));
  await rows.close();
  return held;
}

describe('a server whose secrets AWS Parameter Store keeps, as it starts', () => {
  it('starts with no key and makes no key file, keeps its own key there and reads it again at the next start, and logs where secrets are kept and nothing of a value or a credential', async () => {
    const { fileName, directory, remove } = temporaryLedger();
    onTestFinished(remove);

    const stderr = `${await startedUnder(inTheManager(fileName))}\n${await startedUnder(inTheManager(fileName))}`;
    const [held] = await heldInTheManager(fileName);
    const [kept] = await ownKeyFactsIn(fileName);
    const name = String(held?.holding.held).replace(/:1$/u, '');
    const ownKey = String(parameterStore.parameter(name)?.versions[0]);

    expect(stderr.split('\n').filter((line) => line.includes('Secrets are kept'))).toEqual([
      expect.stringContaining(
        `"message":"Secrets are kept in AWS Parameter Store under ${prefix} in eu-west-1, and 0 kept by the previous keeper were moved there"`,
      ),
      expect.stringContaining(`Secrets are kept in AWS Parameter Store under ${prefix} in eu-west-1, and 0 kept`),
    ]);
    expect(existsSync(`${directory}/secrets.key`)).toBe(false);
    expect(held).toEqual({
      id: kept?.data.secret_id,
      version: 1,
      holding: { keptBy: 'aws-parameter-store', held: `${prefix}/${String(kept?.data.secret_id)}:1` },
    });
    expect(Buffer.from(ownKey, 'base64')).toHaveLength(32);
    expect(
      [ownKey, credentials.accessKeyId, credentials.secretAccessKey].filter((secret) => stderr.includes(secret)),
    ).toEqual([]);
  });
});

describe('a server that moves its secrets into AWS Parameter Store, as it starts', () => {
  it('moves the key it keeps for itself from the ledger with the secrets, and starts under the manager alone with it', async () => {
    const { fileName, remove } = temporaryLedger();
    onTestFinished(remove);
    const key = { SECRETS_KEY: Buffer.alloc(32, 9).toString('base64') };
    const sealed = await startedUnder({ HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: fileName, ...key });
    const [kept] = await ownKeyFactsIn(fileName);

    const moving = await startedUnder({ ...inTheManager(fileName), ...key, SECRETS_KEEPER_PREVIOUS: 'ledger' });
    const alone = await startedUnder(inTheManager(fileName));

    expect(sealed).toContain('and 0 sealed under the previous key were sealed again under it"');
    expect(moving).toContain(
      `"message":"Secrets are kept in AWS Parameter Store under ${prefix} in eu-west-1, and 1 kept by the previous keeper were moved there"`,
    );
    expect(alone).toContain(`Secrets are kept in AWS Parameter Store under ${prefix} in eu-west-1, and 0 kept`);
    expect(await heldInTheManager(fileName)).toEqual([
      {
        id: kept?.data.secret_id,
        version: 1,
        holding: { keptBy: 'aws-parameter-store', held: `${prefix}/${String(kept?.data.secret_id)}:1` },
      },
    ]);
    expect(await ownKeyFactsIn(fileName)).toHaveLength(1);
  });
});

describe('a server whose prefix in AWS Parameter Store cannot be used, as it starts', () => {
  it('stops the process at start for a prefix the identity may not write, naming the setting, the prefix and the words of the manager', async () => {
    parameterStore.tell('denied', ['PutParameter']);
    onTestFinished(() => {
      parameterStore.tell('answering');
    });
    const { fileName, remove } = temporaryLedger();
    onTestFinished(remove);
    const child = spawnServer(mainModule, inTheManager(fileName));

    const exitCode = await child.exited;

    expect(exitCode).toBe(1);
    expect(child.output().stderr.split('\n').at(-2)).toMatch(
      new RegExp(
        `^Auto Runtime could not start: InvalidSettingsError: The secrets settings are invalid. SECRETS_KEEPER: AWS Parameter Store under ${prefix} could not write, read and delete a parameter at start: AWS Parameter Store could not write the parameter ${prefix}/probe-[\\da-f-]{36}: AccessDeniedException: User: user/runtime is not authorized to perform: ssm:PutParameter`,
        'u',
      ),
    );
  });
});

const readInTheWest = `The runtime read the key it keeps for retry_state in AWS Parameter Store under ${prefix} in eu-west-1`;

const goneInTheNorth = `The key the runtime keeps for retry_state is no longer in AWS Parameter Store under ${prefix} in eu-north-1, the region AWS_REGION names, so the server does not start`;

describe('a server whose own key is gone from AWS Parameter Store, as it starts', () => {
  it('logs where its own key is and its id at start, in the words the page quotes, and stops a later start once that parameter is deleted, naming the prefix, the region and the variable that names it', async () => {
    const { fileName, remove } = temporaryLedger();
    onTestFinished(remove);
    const first = await startedUnder(inTheManager(fileName));
    const [kept] = await ownKeyFactsIn(fileName);
    const secretId = String(kept?.data.secret_id);
    parameterStore.remove(`${prefix}/${secretId}`);
    const child = spawnServer(mainModule, inTheManager(fileName));

    const exitCode = await child.exited;

    expect(first).toContain(`"message":"${readInTheWest}"`);
    expect(first).toContain(`"own_key":"retry_state","own_key_id":"${secretId}"`);
    expect(page).toContain(`\`${readInTheWest}\``);
    expect(exitCode).toBe(1);
    expect(child.output().stderr.split('\n').slice(-2)).toEqual([
      `Auto Runtime could not start: OwnKeyUnavailable: The key the runtime keeps for retry_state is no longer in AWS Parameter Store under ${prefix} in eu-west-1, the region AWS_REGION names, so the server does not start`,
      '',
    ]);
  });
});

describe('a server started in another region than the one its secrets are kept in', () => {
  it('stops a start in another region at its own key, after a probe that passes, in the words the page quotes, serving nothing and writing nothing there but the probe, and starts once the region is set back', async () => {
    const { fileName, remove } = temporaryLedger();
    onTestFinished(remove);
    await startedUnder(inTheManager(fileName));
    const child = spawnServer(mainModule, {
      ...inTheManager(fileName),
      AWS_REGION: 'eu-north-1',
      AWS_ENDPOINT_URL_SSM: elsewhere.url,
    });

    const exitCode = await child.exited;
    const setBack = await startedUnder(inTheManager(fileName));
    const [kept] = await ownKeyFactsIn(fileName);
    const probe = `${prefix}/probe-[\\da-f-]{36}`;

    expect(exitCode).toBe(1);
    expect(child.output().stdout).toBe('');
    expect(child.output().stderr.split('\n').slice(-2)).toEqual([
      `Auto Runtime could not start: OwnKeyUnavailable: ${goneInTheNorth}`,
      '',
    ]);
    expect(page).toContain(`\`${goneInTheNorth}\``);
    expect(elsewhere.calls().map(({ operation, name, answer }) => `${operation} ${name} ${answer}`)).toEqual([
      expect.stringMatching(new RegExp(`^PutParameter ${probe} answered$`, 'u')),
      expect.stringMatching(new RegExp(`^GetParameter ${probe} answered$`, 'u')),
      expect.stringMatching(new RegExp(`^DeleteParameter ${probe} answered$`, 'u')),
      `GetParameter ${prefix}/${String(kept?.data.secret_id)} ParameterNotFound`,
    ]);
    expect(setBack).toContain(`Secrets are kept in AWS Parameter Store under ${prefix} in eu-west-1, and 0 kept`);
  });
});
