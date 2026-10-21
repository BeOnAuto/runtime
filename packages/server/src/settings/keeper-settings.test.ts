import type { Environment } from '@on.auto/config';
import { describe, expect, it } from 'vitest';

import { variablesTheRuntimeReads } from '../connections/variables-the-runtime-reads.ts';
import { readSettings } from './settings.ts';

function errorFrom(environment: Environment): string {
  try {
    readSettings(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

function keepingOf(environment: Environment) {
  const { keepers, secrets } = readSettings(environment);
  return { keepers, custodian: secrets?.current.from };
}

const key = Buffer.alloc(32, 1).toString('base64');

const databaseUrl = 'postgresql://playbooks:a-secret-password@db.example.com:5432/playbooks';

const inTheManager = 'aws-parameter-store:/auto-runtime/secrets';

const refusedAs = 'InvalidSettingsError: The secrets settings are invalid.';

const aKeeperInWords =
  "Expected ledger, or aws-parameter-store:<prefix> with the prefix an absolute parameter path such as /auto-runtime/secrets, of at most 14 segments of letters, digits, '.', '-' and '_', the first beginning with neither aws nor ssm, and no slash at its end";

const theLedger = { kind: 'ledger', setting: 'SECRETS_KEEPER' };

function theManager(setting: string, region: string, regionSetting = 'AWS_REGION') {
  return { kind: 'aws-parameter-store', setting, prefix: '/auto-runtime/secrets', region, regionSetting };
}

describe('the keepers of the secrets settings', () => {
  it('keep secrets in the ledger by default, or where SECRETS_KEEPER is ledger, with a custodian as before', () => {
    expect([keepingOf({}), keepingOf({ SECRETS_KEEPER: ' ledger\n', SECRETS_KEY: key })]).toEqual([
      { keepers: { current: theLedger, previous: undefined }, custodian: 'file' },
      { keepers: { current: theLedger, previous: undefined }, custodian: 'environment' },
    ]);
  });

  it('read SECRETS_KEEPER as AWS Parameter Store under a prefix, in the region AWS_REGION names or else AWS_DEFAULT_REGION, with no custodian, beside a ledger in a file or in PostgreSQL', () => {
    expect([
      keepingOf({ SECRETS_KEEPER: ` ${inTheManager}\n`, AWS_REGION: 'eu-west-1', AWS_DEFAULT_REGION: 'us-east-1' }),
      keepingOf({ SECRETS_KEEPER: inTheManager, AWS_REGION: '', AWS_DEFAULT_REGION: 'eu-north-1' }),
      keepingOf({ SECRETS_KEEPER: inTheManager, AWS_REGION: 'eu-west-1', DATABASE_URL: databaseUrl }),
    ]).toEqual([
      { keepers: { current: theManager('SECRETS_KEEPER', 'eu-west-1'), previous: undefined }, custodian: undefined },
      {
        keepers: { current: theManager('SECRETS_KEEPER', 'eu-north-1', 'AWS_DEFAULT_REGION'), previous: undefined },
        custodian: undefined,
      },
      { keepers: { current: theManager('SECRETS_KEEPER', 'eu-west-1'), previous: undefined }, custodian: undefined },
    ]);
  });

  it('read SECRETS_KEEPER_PREVIOUS beside SECRETS_KEEPER, to move the secrets from the ledger and back, with a custodian for the ledger', () => {
    expect([
      keepingOf({
        SECRETS_KEEPER: inTheManager,
        SECRETS_KEEPER_PREVIOUS: 'ledger',
        SECRETS_KEY: key,
        AWS_REGION: 'eu-west-1',
      }),
      keepingOf({ SECRETS_KEEPER: 'ledger', SECRETS_KEEPER_PREVIOUS: inTheManager, AWS_REGION: 'eu-west-1' }),
    ]).toEqual([
      {
        keepers: {
          current: theManager('SECRETS_KEEPER', 'eu-west-1'),
          previous: { kind: 'ledger', setting: 'SECRETS_KEEPER_PREVIOUS' },
        },
        custodian: 'environment',
      },
      {
        keepers: { current: theLedger, previous: theManager('SECRETS_KEEPER_PREVIOUS', 'eu-west-1') },
        custodian: 'file',
      },
    ]);
  });
});

describe('the variables of the keepers', () => {
  it('are among the variables the runtime reads for itself, which no connection may name, with AWS_DEFAULT_REGION', () => {
    expect(variablesTheRuntimeReads).toEqual(
      expect.arrayContaining(['SECRETS_KEEPER', 'SECRETS_KEEPER_PREVIOUS', 'AWS_REGION', 'AWS_DEFAULT_REGION']),
    );
  });
});

describe('the keepers of the secrets settings that cannot be read', () => {
  it.each([
    ['another kind of keeper', 'secrets-manager:/auto-runtime/secrets'],
    ['the kind alone', 'aws-parameter-store'],
    ['an empty prefix', 'aws-parameter-store:'],
    ['a relative prefix', 'aws-parameter-store:auto-runtime/secrets'],
    ['a prefix with a slash at its end', 'aws-parameter-store:/auto-runtime/secrets/'],
    ['a prefix with an empty segment', 'aws-parameter-store:/auto-runtime//secrets'],
    ['a prefix with a space', 'aws-parameter-store:/auto runtime/secrets'],
    ['a prefix with a colon', 'aws-parameter-store:/auto-runtime:secrets'],
    ['a prefix under the reserved aws', 'aws-parameter-store:/aws/secrets'],
    ['a prefix under the reserved ssm', 'aws-parameter-store:/SSM-secrets/runtime'],
    ['a prefix of fifteen segments', `aws-parameter-store:${'/level'.repeat(15)}`],
    ['the ledger in capitals', 'LEDGER'],
  ])('stop the server at start for a SECRETS_KEEPER of %s, naming the setting', (_, value) => {
    expect(errorFrom({ SECRETS_KEEPER: value, AWS_REGION: 'eu-west-1' })).toBe(
      `${refusedAs} SECRETS_KEEPER: ${aKeeperInWords}`,
    );
  });
});

describe('the keepers of the secrets settings at their bounds', () => {
  it('take a prefix of fourteen segments, which with the id of a secret makes the fifteen levels a parameter may have', () => {
    const prefix = '/level'.repeat(14);

    expect(
      readSettings({ SECRETS_KEEPER: `aws-parameter-store:${prefix}`, AWS_REGION: 'eu-west-1' }).keepers.current,
    ).toEqual({
      kind: 'aws-parameter-store',
      setting: 'SECRETS_KEEPER',
      prefix,
      region: 'eu-west-1',
      regionSetting: 'AWS_REGION',
    });
  });

  it('stop the server at start for a keeper in Parameter Store with no region named, naming the setting and AWS_REGION', () => {
    const refusal = `${refusedAs} SECRETS_KEEPER: AWS Parameter Store is asked in the region AWS_REGION names, or AWS_DEFAULT_REGION where that is not set, and neither is, so set AWS_REGION`;

    expect([
      errorFrom({ SECRETS_KEEPER: inTheManager }),
      errorFrom({ SECRETS_KEEPER: inTheManager, AWS_REGION: '' }),
    ]).toEqual([refusal, refusal]);
  });

  it('stop the server at start for a previous keeper without a current one, of the same kind as the current one, or that cannot be read, naming SECRETS_KEEPER_PREVIOUS', () => {
    const region = { AWS_REGION: 'eu-west-1' };

    expect([
      errorFrom({ SECRETS_KEEPER_PREVIOUS: inTheManager, ...region }),
      errorFrom({
        SECRETS_KEEPER: inTheManager,
        SECRETS_KEEPER_PREVIOUS: 'aws-parameter-store:/another/prefix',
        ...region,
      }),
      errorFrom({ SECRETS_KEEPER: 'ledger', SECRETS_KEEPER_PREVIOUS: 'ledger' }),
      errorFrom({ SECRETS_KEEPER: inTheManager, SECRETS_KEEPER_PREVIOUS: 'the ledger', ...region }),
    ]).toEqual([
      `${refusedAs} SECRETS_KEEPER_PREVIOUS: Set it only beside SECRETS_KEEPER, to the keeper that one replaces`,
      `${refusedAs} SECRETS_KEEPER_PREVIOUS: Set it to the keeper SECRETS_KEEPER replaces, which is the other of ledger and aws-parameter-store:<prefix>`,
      `${refusedAs} SECRETS_KEEPER_PREVIOUS: Set it to the keeper SECRETS_KEEPER replaces, which is the other of ledger and aws-parameter-store:<prefix>`,
      `${refusedAs} SECRETS_KEEPER_PREVIOUS: ${aKeeperInWords}`,
    ]);
  });
});

const custodianSettings: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
  ['SECRETS_KEY', { SECRETS_KEY: key }],
  ['SECRETS_KEY_FILE', { SECRETS_KEY_FILE: '/run/secrets/secrets-key' }],
  ['SECRETS_KEY_KMS', { SECRETS_KEY_KMS: 'arn:aws:kms:eu-west-1:111122223333:alias/auto-runtime' }],
  ['SECRETS_KEY_PREVIOUS', { SECRETS_KEY_PREVIOUS: key }],
];

describe('the custodians of secrets kept in AWS Parameter Store alone', () => {
  it.each(custodianSettings)(
    'stop the server at start for %s, which no keeper would use, naming the setting and never its value',
    (setting, given) => {
      const error = errorFrom({ SECRETS_KEEPER: inTheManager, AWS_REGION: 'eu-west-1', ...given });

      expect(error).toBe(
        `${refusedAs} ${setting}: Set it only while the ledger keeps secrets, as SECRETS_KEEPER or SECRETS_KEEPER_PREVIOUS names it, since AWS Parameter Store keeps each value under its own encryption and no key of the runtime's`,
      );
      expect(error).not.toContain(key);
    },
  );

  it('keep the rule that a ledger in PostgreSQL needs a key while the ledger keeps secrets, current or previous, in its words', () => {
    expect(
      errorFrom({
        SECRETS_KEEPER: inTheManager,
        SECRETS_KEEPER_PREVIOUS: 'ledger',
        AWS_REGION: 'eu-west-1',
        DATABASE_URL: databaseUrl,
      }),
    ).toBe(
      `${refusedAs} SECRETS_KEY: Set it, SECRETS_KEY_FILE or SECRETS_KEY_KMS when the ledger is kept in PostgreSQL, since a database that runtimes share needs a key kept on none of their disks`,
    );
  });
});
