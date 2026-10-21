import { readFileSync } from 'node:fs';

import { kmsCustodian, parameterStoreKeeper, type KmsCustodianOptions } from '@on.auto/secrets/aws';
import { serveFakeKms } from '@on.auto/secrets/testing';
import { Effect, Schema } from 'effect';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { ledgerStoresOpenedBy } from './ledger-stores.ts';

const page = readFileSync(new URL('../../../../docs/self-host/production.md', import.meta.url), 'utf8');

const section = page.slice(
  page.indexOf('### Hold the secrets key in a KMS'),
  page.indexOf('## Run it as an always-on service'),
);

interface Block {
  readonly language: string;
  readonly body: string;
}

const blocks = [...section.matchAll(/```(\w+)\n([\s\S]*?)```/gu)].map(
  ([, language = '', body = '']: readonly string[]): Block => ({ language, body }),
);

function environmentOf(body: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    body
      .trim()
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

const shellBlocks = blocks
  .filter(({ language }: Block) => language === 'bash')
  .map(({ body }: Block) => environmentOf(body));

const PolicySchema = Schema.fromJsonString(
  Schema.Struct({
    Version: Schema.String,
    Statement: Schema.Array(
      Schema.Struct({ Effect: Schema.String, Action: Schema.Array(Schema.String), Resource: Schema.String }),
    ),
  }),
);

const policies = blocks
  .filter(({ language }: Block) => language === 'json')
  .map(({ body }: Block) => Schema.decodeUnknownSync(PolicySchema)(body));

const keyArn = 'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';

const quotedRefusal = String(/`(The secrets settings are invalid\. SECRETS_KEY_KMS: [^`]+)`/u.exec(section)?.[1]);

describe('the page that holds the secrets key in a KMS', () => {
  it('sets SECRETS_KEY_KMS to the ARN of a key and of an alias, and rotates from a key in a file in one restart, as the settings read them', () => {
    expect(shellBlocks.map((environment) => readSettings(environment).secrets)).toEqual([
      { current: { from: 'kms', setting: 'SECRETS_KEY_KMS', arn: keyArn, region: 'eu-west-1' }, previous: undefined },
      {
        current: {
          from: 'kms',
          setting: 'SECRETS_KEY_KMS',
          arn: 'arn:aws:kms:eu-west-1:111122223333:alias/auto-runtime',
          region: 'eu-west-1',
        },
        previous: undefined,
      },
      {
        current: { from: 'kms', setting: 'SECRETS_KEY_KMS', arn: keyArn, region: 'eu-west-1' },
        previous: {
          from: 'file',
          setting: 'SECRETS_KEY_FILE_PREVIOUS',
          file: '/run/secrets/secrets-key',
          madeByTheServer: false,
        },
      },
    ]);
  });

  it('grants the identity kms:Encrypt and kms:Decrypt on the key it names', () => {
    expect(policies).toEqual([
      {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: ['kms:Encrypt', 'kms:Decrypt'], Resource: keyArn }],
      },
    ]);
  });
});

const fake = await serveFakeKms({ keys: [keyArn] });

afterAll(fake.close);

const onTheFake = {
  parameterStoreKeeper,
  kmsCustodian: (options: KmsCustodianOptions) =>
    kmsCustodian({
      ...options,
      credentials: { accessKeyId: 'an-access-key', secretAccessKey: 'a-secret-access-key' },
      endpoint: fake.url,
    }),
};

async function startRefusedFor(environment: Readonly<Record<string, string>>): Promise<string> {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  const context = await Effect.runPromise(Effect.context());
  return ledgerStoresOpenedBy(
    context,
    readSettings({ LEDGER_FILE: fileName, ...environment }),
    { store: 'sqlite', file: fileName },
    () => Promise.resolve(onTheFake),
  ).then(() => 'started', String);
}

describe('the refusal the page quotes', () => {
  it('is the words a start under a disabled key stops in', async () => {
    fake.tell(keyArn, 'disabled');

    const refused = await startRefusedFor({ SECRETS_KEY_KMS: keyArn });

    expect(refused).toBe(`InvalidSettingsError: ${quotedRefusal}`);
  });
});
