import { existsSync, readFileSync } from 'node:fs';

import { kmsCustodian, parameterStoreKeeper } from '@on.auto/secrets/aws';
import { fakeKmsInProcess, fakeParameterStoreInProcess } from '@on.auto/secrets/in-process-fakes';
import { Effect, Redacted } from 'effect';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi, type MockInstance } from 'vitest';

import type { AwsAdapters } from '../secrets/aws-adapters.ts';
import { saidAtStart, startedInProcess } from '../testing/processes/in-process-starts.ts';
import { annotationsOf } from '../testing/processes/stderr-lines.ts';
import { ownKeyFactsIn, secretRowsInFile } from '../testing/records/kept-credentials.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const keyId = crypto.randomUUID();

const keyArn = `arn:aws:kms:eu-west-1:111122223333:key/${keyId}`;

const kms = fakeKmsInProcess({ keys: [keyArn] });

const parameterStore = fakeParameterStoreInProcess();

const elsewhere = fakeParameterStoreInProcess({ region: 'eu-north-1' });

const page = readFileSync(new URL('../../../../docs/self-host/secret-manager.md', import.meta.url), 'utf8');

const credentials = { accessKeyId: 'an-access-key-of-the-tests', secretAccessKey: 'a-secret-access-key-of-the-tests' };

const inProcessAws: AwsAdapters = {
  kmsCustodian: (options) => kmsCustodian({ ...options, credentials, requestHandlerOf: kms.requestHandlerOf }),
  parameterStoreKeeper: (options) =>
    parameterStoreKeeper({
      ...options,
      credentials,
      requestHandlerOf: (options.region === 'eu-north-1' ? elsewhere : parameterStore).requestHandlerOf,
    }),
};

function loadAws(): Promise<AwsAdapters> {
  return Promise.resolve(inProcessAws);
}

let logged: MockInstance<typeof console.error>;

beforeEach(() => {
  logged = vi.spyOn(console, 'error');
});

afterEach(() => {
  logged.mockRestore();
});

function aLedgerFile(): string {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  return fileName;
}

function underTheKeyInKms(fileName: string): Readonly<Record<string, string>> {
  return { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: fileName, SECRETS_KEY_KMS: keyArn };
}

const prefix = '/auto-runtime/secrets';

function inTheManager(fileName: string): Readonly<Record<string, string>> {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: fileName,
    SECRETS_KEEPER: `aws-parameter-store:${prefix}`,
    AWS_REGION: 'eu-west-1',
  };
}

/** Starts and stops the server in this process, and answers the lines it logged meanwhile. */
async function startedUnder(environment: Readonly<Record<string, string>>): Promise<string> {
  const before = logged.mock.calls.length;
  const server = await startedInProcess(environment, loadAws);
  await server.stop();
  return logged.mock.calls
    .slice(before)
    .flat()
    .map((line) => `${String(line)}\n`)
    .join('');
}

function startedOnce(fileName: string): Promise<string> {
  return startedUnder(underTheKeyInKms(fileName));
}

async function dataKeysIn(fileName: string): Promise<readonly string[]> {
  const rows = await secretRowsInFile(fileName);
  const held = await Effect.runPromise(rows.heldBy({ keptBy: 'ledger' }, 10));
  await rows.close();
  const proxy = { enabled: false, environment: {} };
  const custodian = await Effect.runPromise(
    kmsCustodian({ keyId: keyArn, region: 'eu-west-1', proxy, credentials, requestHandlerOf: kms.requestHandlerOf }),
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
    const logs = `${first}\n${next}`;

    expect(logs.split('\n').filter((line) => line.includes('Secrets are kept'))).toEqual([
      expect.stringContaining(
        `"message":"Secrets are kept in the ledger's database, sealed under the key ${keyId} that the KMS key ${keyArn} holds, and 0 sealed under the previous key were sealed again under it"`,
      ),
      expect.stringContaining(`that the KMS key ${keyArn} holds, and 0 sealed`),
    ]);
    expect(dataKeys.length).toBeGreaterThan(0);
    expect(
      [credentials.accessKeyId, credentials.secretAccessKey, ...dataKeys].filter((secret) => logs.includes(secret)),
    ).toEqual([]);
  });

  it('stops the start for a key that is disabled, naming the setting, the key and the words of KMS', async () => {
    kms.tell(keyArn, 'disabled');
    onTestFinished(() => {
      kms.tell(keyArn, 'enabled');
    });

    const said = await saidAtStart(underTheKeyInKms(aLedgerFile()), loadAws);

    expect(said).toEqual({
      exitCode: 1,
      line: `Auto Runtime could not start: InvalidSettingsError: The secrets settings are invalid. SECRETS_KEY_KMS: The KMS key ${keyId} it names could not wrap and unwrap a data key at start: The custodian of the key ${keyId} refused to wrap a data key: DisabledException: key/${keyId} is disabled.\n`,
    });
  });
});

async function heldInTheManager(fileName: string) {
  const rows = await secretRowsInFile(fileName);
  const held = await Effect.runPromise(rows.heldBy({ keptBy: 'aws-parameter-store' }, 10));
  await rows.close();
  return held;
}

describe('a server whose secrets AWS Parameter Store keeps, as it starts', () => {
  it('starts with no key and makes no key file, keeps its own key there and reads it again at the next start, and logs where secrets are kept and nothing of a value or a credential', async () => {
    const { fileName, directory, remove } = temporaryLedger();
    onTestFinished(remove);

    const logs = `${await startedUnder(inTheManager(fileName))}\n${await startedUnder(inTheManager(fileName))}`;
    const [held] = await heldInTheManager(fileName);
    const [kept] = await ownKeyFactsIn(fileName);
    const name = String(held?.holding.held).replace(/:1$/u, '');
    const ownKey = String(parameterStore.parameter(name)?.versions[0]);

    expect(logs.split('\n').filter((line) => line.includes('Secrets are kept'))).toEqual([
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
      [ownKey, credentials.accessKeyId, credentials.secretAccessKey].filter((secret) => logs.includes(secret)),
    ).toEqual([]);
  });
});

function ownKeysInTheManager(kept: Awaited<ReturnType<typeof ownKeyFactsIn>>): readonly string[] {
  return kept.flatMap(({ data }) => parameterStore.parameter(`${prefix}/${data.secret_id}`)?.versions ?? []);
}

function movedIntoTheManager(logs: string): readonly unknown[] {
  return annotationsOf(logs)
    .filter(({ secrets_keeper: keeper }) => keeper === 'aws-parameter-store')
    .map(({ secrets_moved: moved }) => moved);
}

describe('a server that moves its secrets into AWS Parameter Store, as it starts', () => {
  it('moves the keys it keeps for itself from the ledger with the secrets, starts under the manager alone with them, and logs how many it moved and nothing of a key or a credential', async () => {
    const { fileName, remove } = temporaryLedger();
    onTestFinished(remove);
    const key = { SECRETS_KEY: Buffer.alloc(32, 9).toString('base64') };
    const sealed = await startedUnder({ HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: fileName, ...key });
    const kept = await ownKeyFactsIn(fileName);

    const moving = await startedUnder({ ...inTheManager(fileName), ...key, SECRETS_KEEPER_PREVIOUS: 'ledger' });
    const alone = await startedUnder(inTheManager(fileName));
    const ownKeys = ownKeysInTheManager(kept);
    const logs = [sealed, moving, alone].join('\n');

    expect(sealed).toContain('and 0 sealed under the previous key were sealed again under it"');
    expect(moving).toContain(`"message":"Secrets are kept in AWS Parameter`);
    expect(alone).toContain(`Secrets are kept in AWS Parameter Store under ${prefix} in eu-west-1, and 0 kept`);
    expect([movedIntoTheManager(moving), movedIntoTheManager(alone)]).toEqual([[kept.length], [0]]);
    expect(ownKeys).toHaveLength(kept.length);
    expect(
      [key.SECRETS_KEY, ...ownKeys, credentials.accessKeyId, credentials.secretAccessKey].filter((secret) =>
        logs.includes(secret),
      ),
    ).toEqual([]);
    expect(await heldInTheManager(fileName)).toEqual(
      kept.map(({ data }) => ({
        id: data.secret_id,
        version: 1,
        holding: { keptBy: 'aws-parameter-store', held: `${prefix}/${data.secret_id}:1` },
      })),
    );
    expect((await ownKeyFactsIn(fileName)).map(({ data }) => data.purpose)).toEqual(['retry_state', 'content_address']);
  });
});

describe('a server whose prefix in AWS Parameter Store cannot be used, as it starts', () => {
  it('stops the start for a prefix the identity may not write, naming the setting, the prefix and the words of the manager', async () => {
    parameterStore.tell('denied', ['PutParameter']);
    onTestFinished(() => {
      parameterStore.tell('answering');
    });

    const said = await saidAtStart(inTheManager(aLedgerFile()), loadAws);

    expect(said.exitCode).toBe(1);
    expect(said.line).toMatch(
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
    const fileName = aLedgerFile();
    const first = await startedUnder(inTheManager(fileName));
    const [kept] = await ownKeyFactsIn(fileName);
    const secretId = String(kept?.data.secret_id);
    parameterStore.remove(`${prefix}/${secretId}`);

    const said = await saidAtStart(inTheManager(fileName), loadAws);

    expect(first).toContain(`"message":"${readInTheWest}"`);
    expect(first).toContain(`"own_key":"retry_state","own_key_id":"${secretId}"`);
    expect(page).toContain(`\`${readInTheWest}\``);
    expect(said).toEqual({
      exitCode: 1,
      line: `Auto Runtime could not start: OwnKeyUnavailable: The key the runtime keeps for retry_state is no longer in AWS Parameter Store under ${prefix} in eu-west-1, the region AWS_REGION names, so the server does not start\n`,
    });
  });
});

describe('a server started in another region than the one its secrets are kept in', () => {
  it('stops a start in another region at its own key, after a probe that passes, in the words the page quotes, writing nothing there but the probe, and starts once the region is set back', async () => {
    const fileName = aLedgerFile();
    await startedUnder(inTheManager(fileName));

    const said = await saidAtStart({ ...inTheManager(fileName), AWS_REGION: 'eu-north-1' }, loadAws);
    const setBack = await startedUnder(inTheManager(fileName));
    const [kept] = await ownKeyFactsIn(fileName);
    const probe = `${prefix}/probe-[\\da-f-]{36}`;

    expect(said).toEqual({ exitCode: 1, line: `Auto Runtime could not start: OwnKeyUnavailable: ${goneInTheNorth}\n` });
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
