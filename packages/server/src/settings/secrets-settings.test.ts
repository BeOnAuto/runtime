import type { Environment } from '@on.auto/config';
import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { secretsVariables, type SecretsKeySource } from './secrets-settings.ts';
import { readSettings } from './settings.ts';

function errorFrom(environment: Environment): string {
  try {
    readSettings(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

function revealed(source: SecretsKeySource | undefined): unknown {
  return source?.from === 'environment' ? { ...source, key: [...Redacted.value(source.key)] } : source;
}

function secretsOf(environment: Environment) {
  const { current, previous } = readSettings(environment).secrets;
  return { current: revealed(current), previous: revealed(previous) };
}

const current = Buffer.alloc(32, 1).toString('base64');

const previous = Buffer.alloc(32, 2).toString('base64');

const ones = Array.from({ length: 32 }, () => 1);

const twos = Array.from({ length: 32 }, () => 2);

const databaseUrl = 'postgresql://playbooks:a-secret-password@db.example.com:5432/playbooks';

const refusedAs = 'InvalidSettingsError: The secrets settings are invalid.';

const aKeyInWords = 'the base64 of 32 bytes, as openssl rand -base64 32 prints it';

describe('the secrets settings', () => {
  it('are the six variables the runtime reads for itself, a key, a file and a key in KMS each for the current key and the previous one', () => {
    expect(secretsVariables).toEqual([
      'SECRETS_KEY',
      'SECRETS_KEY_FILE',
      'SECRETS_KEY_KMS',
      'SECRETS_KEY_PREVIOUS',
      'SECRETS_KEY_FILE_PREVIOUS',
      'SECRETS_KEY_KMS_PREVIOUS',
    ]);
  });

  it('keep the key in secrets.key beside the ledger file, made when it is missing, when neither SECRETS_KEY nor SECRETS_KEY_FILE is set', () => {
    expect([secretsOf({}), secretsOf({ LEDGER_FILE: '/data/playbooks.db' })]).toEqual([
      {
        current: { from: 'file', setting: 'SECRETS_KEY_FILE', file: 'data/secrets.key', madeByTheServer: true },
        previous: undefined,
      },
      {
        current: { from: 'file', setting: 'SECRETS_KEY_FILE', file: '/data/secrets.key', madeByTheServer: true },
        previous: undefined,
      },
    ]);
  });

  it('make a key at start for a private ledger in memory, which no file outlasts', () => {
    expect(secretsOf({ LEDGER_FILE: ':memory:' })).toEqual({ current: { from: 'start' }, previous: undefined });
  });
});

describe('the secrets settings that name the keys', () => {
  it('read SECRETS_KEY and SECRETS_KEY_PREVIOUS as the bytes their base64 gives, around any whitespace', () => {
    const given = readSettings({ SECRETS_KEY: ` ${current}\n`, SECRETS_KEY_PREVIOUS: previous }).secrets;

    expect([
      { current: revealed(given.current), previous: revealed(given.previous) },
      secretsOf({ SECRETS_KEY: current, DATABASE_URL: databaseUrl }),
    ]).toEqual([
      {
        current: { from: 'environment', setting: 'SECRETS_KEY', key: ones },
        previous: { from: 'environment', setting: 'SECRETS_KEY_PREVIOUS', key: twos },
      },
      { current: { from: 'environment', setting: 'SECRETS_KEY', key: ones }, previous: undefined },
    ]);
    expect(JSON.stringify(given)).not.toContain(current);
  });

  it('read SECRETS_KEY_FILE and SECRETS_KEY_FILE_PREVIOUS as files that are read and never made, beside a ledger in PostgreSQL too', () => {
    expect(
      secretsOf({
        SECRETS_KEY_FILE: '/run/secrets/secrets-key',
        SECRETS_KEY_FILE_PREVIOUS: 'previous.key',
        DATABASE_URL: databaseUrl,
      }),
    ).toEqual({
      current: { from: 'file', setting: 'SECRETS_KEY_FILE', file: '/run/secrets/secrets-key', madeByTheServer: false },
      previous: { from: 'file', setting: 'SECRETS_KEY_FILE_PREVIOUS', file: 'previous.key', madeByTheServer: false },
    });
  });

  it('take the current key from one variable and the key it replaces from the other kind', () => {
    expect([
      secretsOf({ SECRETS_KEY: current, SECRETS_KEY_FILE_PREVIOUS: 'previous.key' }),
      secretsOf({ SECRETS_KEY_FILE: 'secrets.key', SECRETS_KEY_PREVIOUS: previous }),
    ]).toEqual([
      {
        current: { from: 'environment', setting: 'SECRETS_KEY', key: ones },
        previous: { from: 'file', setting: 'SECRETS_KEY_FILE_PREVIOUS', file: 'previous.key', madeByTheServer: false },
      },
      {
        current: { from: 'file', setting: 'SECRETS_KEY_FILE', file: 'secrets.key', madeByTheServer: false },
        previous: { from: 'environment', setting: 'SECRETS_KEY_PREVIOUS', key: twos },
      },
    ]);
  });
});

describe('the secrets settings that cannot be read', () => {
  it.each([
    ['not base64', 'not a key at all!'],
    ['16 bytes', Buffer.alloc(16, 1).toString('base64')],
    ['33 bytes', Buffer.alloc(33, 1).toString('base64')],
    ['base64url', Buffer.alloc(32, 255).toString('base64url')],
    ['base64 without its padding', current.replace('=', '')],
  ])('stop the server at start for a SECRETS_KEY of %s, naming the setting and never its value', (_, value) => {
    const error = errorFrom({ SECRETS_KEY: value });

    expect(error).toBe(`${refusedAs} SECRETS_KEY: Expected ${aKeyInWords}`);
    expect(error).not.toContain(value);
  });

  it('stop the server at start for a SECRETS_KEY_PREVIOUS that is not the base64 of 32 bytes', () => {
    expect(errorFrom({ SECRETS_KEY: current, SECRETS_KEY_PREVIOUS: 'short' })).toBe(
      `${refusedAs} SECRETS_KEY_PREVIOUS: Expected ${aKeyInWords}`,
    );
  });

  it('stop the server at start for a key in the environment and in a file both, of the current key or of the previous one, naming the settings', () => {
    expect([
      errorFrom({ SECRETS_KEY: current, SECRETS_KEY_FILE: 'secrets.key' }),
      errorFrom({ SECRETS_KEY: current, SECRETS_KEY_PREVIOUS: previous, SECRETS_KEY_FILE_PREVIOUS: 'previous.key' }),
    ]).toEqual([
      `${refusedAs} SECRETS_KEY: Set one of SECRETS_KEY, SECRETS_KEY_FILE and SECRETS_KEY_KMS, not more`,
      `${refusedAs} SECRETS_KEY_PREVIOUS: Set one of SECRETS_KEY_PREVIOUS, SECRETS_KEY_FILE_PREVIOUS and SECRETS_KEY_KMS_PREVIOUS, not more`,
    ]);
  });

  it('stop the server at start for a previous key without a current one, naming the setting given', () => {
    expect([
      errorFrom({ SECRETS_KEY_PREVIOUS: previous }),
      errorFrom({ SECRETS_KEY_FILE_PREVIOUS: 'previous.key' }),
    ]).toEqual([
      `${refusedAs} SECRETS_KEY_PREVIOUS: Set it only beside SECRETS_KEY, SECRETS_KEY_FILE or SECRETS_KEY_KMS, to the key that one replaces`,
      `${refusedAs} SECRETS_KEY_FILE_PREVIOUS: Set it only beside SECRETS_KEY, SECRETS_KEY_FILE or SECRETS_KEY_KMS, to the key that one replaces`,
    ]);
  });

  it('stop the server at start for a ledger in PostgreSQL without SECRETS_KEY, SECRETS_KEY_FILE or SECRETS_KEY_KMS, naming the setting and no URL', () => {
    const error = errorFrom({ DATABASE_URL: databaseUrl });

    expect(error).toBe(
      `${refusedAs} SECRETS_KEY: Set it, SECRETS_KEY_FILE or SECRETS_KEY_KMS when the ledger is kept in PostgreSQL, since a database that runtimes share needs a key kept on none of their disks`,
    );
    expect(error).not.toMatch(/a-secret-password|db\.example\.com/u);
  });
});

const keyArn = 'arn:aws:kms:eu-central-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';

const aliasArn = 'arn:aws:kms:us-west-2:111122223333:alias/team/auto-runtime';

const multiRegionArn = 'arn:aws:kms:ap-southeast-3:111122223333:key/mrk-1234abcd12ab34cd56ef1234567890ab';

describe('the secrets settings that name a key in AWS KMS', () => {
  it('read SECRETS_KEY_KMS as the ARN of a key, a multi-Region key or an alias, the region the ARN names, beside a ledger in PostgreSQL too', () => {
    expect([
      secretsOf({ SECRETS_KEY_KMS: ` ${keyArn}\n`, DATABASE_URL: databaseUrl }),
      secretsOf({ SECRETS_KEY_KMS: aliasArn }),
      secretsOf({ SECRETS_KEY_KMS: multiRegionArn }),
    ]).toEqual([
      {
        current: { from: 'kms', setting: 'SECRETS_KEY_KMS', arn: keyArn, region: 'eu-central-1' },
        previous: undefined,
      },
      {
        current: { from: 'kms', setting: 'SECRETS_KEY_KMS', arn: aliasArn, region: 'us-west-2' },
        previous: undefined,
      },
      {
        current: { from: 'kms', setting: 'SECRETS_KEY_KMS', arn: multiRegionArn, region: 'ap-southeast-3' },
        previous: undefined,
      },
    ]);
  });
});

describe('the secrets settings that rotate to or from a key in AWS KMS', () => {
  it('take a key in KMS as the key that replaces a key in hand, and a key in hand as the key that replaces one in KMS', () => {
    expect([
      secretsOf({ SECRETS_KEY_KMS: keyArn, SECRETS_KEY_PREVIOUS: previous }),
      secretsOf({ SECRETS_KEY: current, SECRETS_KEY_KMS_PREVIOUS: aliasArn }),
    ]).toEqual([
      {
        current: { from: 'kms', setting: 'SECRETS_KEY_KMS', arn: keyArn, region: 'eu-central-1' },
        previous: { from: 'environment', setting: 'SECRETS_KEY_PREVIOUS', key: twos },
      },
      {
        current: { from: 'environment', setting: 'SECRETS_KEY', key: ones },
        previous: { from: 'kms', setting: 'SECRETS_KEY_KMS_PREVIOUS', arn: aliasArn, region: 'us-west-2' },
      },
    ]);
  });
});

describe('the secrets settings that name a key in AWS KMS and cannot be read', () => {
  it.each([
    ['the id of a key alone', '1234abcd-12ab-34cd-56ef-1234567890ab'],
    ['an alias name alone', 'alias/auto-runtime'],
    ['the ARN of a key of another service', 'arn:aws:secretsmanager:eu-central-1:111122223333:secret:runtime'],
    ['an ARN without its account', 'arn:aws:kms:eu-central-1::key/1234abcd-12ab-34cd-56ef-1234567890ab'],
    ['an ARN without a region', 'arn:aws:kms::111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'],
    ['an ARN whose key is no key id', 'arn:aws:kms:eu-central-1:111122223333:key/runtime'],
    ['an ARN of a resource other than a key or an alias', 'arn:aws:kms:eu-central-1:111122223333:grant/1234'],
    ['an ARN of another partition', 'arn:aws-cn:kms:cn-north-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'],
  ])('stop the server at start for a SECRETS_KEY_KMS that is %s, naming the setting', (_, value) => {
    expect(errorFrom({ SECRETS_KEY_KMS: value })).toBe(
      `${refusedAs} SECRETS_KEY_KMS: Expected the ARN of a symmetric AWS KMS key, arn:aws:kms:<region>:<account>:key/<id>, or of an alias of one, arn:aws:kms:<region>:<account>:alias/<name>`,
    );
  });

  it('stop the server at start for a key in KMS beside a key in hand, and for a previous key in KMS without a current one', () => {
    expect([
      errorFrom({ SECRETS_KEY_FILE: 'secrets.key', SECRETS_KEY_KMS: keyArn }),
      errorFrom({ SECRETS_KEY: current, SECRETS_KEY_KMS_PREVIOUS: keyArn, SECRETS_KEY_PREVIOUS: previous }),
      errorFrom({ SECRETS_KEY_KMS_PREVIOUS: keyArn }),
      errorFrom({ SECRETS_KEY_KMS: keyArn, SECRETS_KEY_KMS_PREVIOUS: 'alias/auto-runtime' }),
    ]).toEqual([
      `${refusedAs} SECRETS_KEY: Set one of SECRETS_KEY, SECRETS_KEY_FILE and SECRETS_KEY_KMS, not more`,
      `${refusedAs} SECRETS_KEY_PREVIOUS: Set one of SECRETS_KEY_PREVIOUS, SECRETS_KEY_FILE_PREVIOUS and SECRETS_KEY_KMS_PREVIOUS, not more`,
      `${refusedAs} SECRETS_KEY_KMS_PREVIOUS: Set it only beside SECRETS_KEY, SECRETS_KEY_FILE or SECRETS_KEY_KMS, to the key that one replaces`,
      expect.stringContaining(`${refusedAs} SECRETS_KEY_KMS_PREVIOUS: Expected the ARN of a symmetric AWS KMS key`),
    ]);
  });
});
