import { readFileSync } from 'node:fs';

import { kmsCustodian, parameterStoreKeeper } from '@on.auto/secrets/aws';
import { serveFakeParameterStore } from '@on.auto/secrets/served-fakes';
import { Effect, Logger, Schema } from 'effect';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import type { AwsAdapters } from '../secrets/aws-adapters.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { ledgerStoresOpenedBy } from './ledger-stores.ts';
import { sqliteLedgerDatabase } from './sqlite-ledger-database.ts';

const page = readFileSync(new URL('../../../../docs/self-host/secret-manager.md', import.meta.url), 'utf8');

interface Block {
  readonly language: string;
  readonly body: string;
}

const blocks = [...page.matchAll(/```(\w+)\n([\s\S]*?)```/gu)].map(
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

const environments = blocks.filter(({ language }: Block) => language === 'bash').map(({ body }) => environmentOf(body));

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

function quotedFrom(start: string): string {
  const at = page.indexOf(`\`${start}`) + 1;
  return page.slice(at, page.indexOf('`', at));
}

const quotedRefusal = quotedFrom('The secrets settings are invalid. SECRETS_KEEPER: ');

const quotedStartLine = quotedFrom(
  'Secrets are kept in AWS Parameter Store under /auto-runtime/secrets in eu-west-1, and 0 ',
);

const inTheManager = {
  kind: 'aws-parameter-store',
  setting: 'SECRETS_KEEPER',
  prefix: '/auto-runtime/secrets',
  region: 'eu-west-1',
  regionSetting: 'AWS_REGION',
};

describe('the page that keeps secrets in a secret manager', () => {
  it('names the manager alone, then the move from the ledger and back, as the settings read them', () => {
    expect(
      environments.map((environment) => {
        const { keepers, secrets } = readSettingsOf(environment);
        return { keepers, custodian: secrets?.current.from };
      }),
    ).toEqual([
      { keepers: { current: inTheManager, previous: undefined }, custodian: undefined },
      {
        keepers: { current: inTheManager, previous: { kind: 'ledger', setting: 'SECRETS_KEEPER_PREVIOUS' } },
        custodian: 'file',
      },
      {
        keepers: {
          current: { kind: 'ledger', setting: 'SECRETS_KEEPER' },
          previous: { ...inTheManager, setting: 'SECRETS_KEEPER_PREVIOUS' },
        },
        custodian: 'file',
      },
    ]);
  });

  it('grants the identity the three actions of the keeper on the parameters under the prefix', () => {
    expect(policies).toEqual([
      {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['ssm:PutParameter', 'ssm:GetParameter', 'ssm:DeleteParameter'],
            Resource: 'arn:aws:ssm:eu-west-1:111122223333:parameter/auto-runtime/secrets/*',
          },
        ],
      },
    ]);
  });
});

const fake = await serveFakeParameterStore({ region: 'eu-west-1', account: '111122223333' });

afterAll(fake.close);

const onTheFake: AwsAdapters = {
  kmsCustodian,
  parameterStoreKeeper: (options) =>
    parameterStoreKeeper({
      ...options,
      credentials: { accessKeyId: 'an-access-key', secretAccessKey: 'a-secret-access-key' },
      endpoint: fake.url,
    }),
};

async function startedUnder(environment: Readonly<Record<string, string>>) {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(Logger.layer([capture]))));
  const started = await ledgerStoresOpenedBy(
    context,
    readSettingsOf({ LEDGER_FILE: fileName, ...environment }),
    sqliteLedgerDatabase(fileName),
    () => Promise.resolve(onTheFake),
  ).then(
    async (stores) => {
      await stores.secrets.close();
      return 'started';
    },
    (failure: unknown) => String(failure).replaceAll(/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}/gu, '<id>'),
  );
  return { started, lines: lines.join('\n') };
}

describe('the words the page quotes', () => {
  it('are the line a start under the manager logs, and the words a start stops in where the identity may not write under the prefix', async () => {
    const [environment = {}] = environments;
    const logged = await startedUnder(environment);
    fake.tell('denied', ['PutParameter']);
    onTestFinished(() => {
      fake.tell('answering');
    });

    const refused = await startedUnder(environment);

    expect(logged.lines).toContain(`"message":"${quotedStartLine}"`);
    expect(refused.started).toBe(`InvalidSettingsError: ${quotedRefusal}`);
  });
});
