import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { SecretsKeyGiven, SecretsKeySource } from '../settings/secrets-settings.ts';
import { retryStateKeysOf, secretsKeysOf } from './secrets-keys.ts';

function aFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-secrets-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

function besideTheLedger(file: string): SecretsKeyGiven {
  return { from: 'file', setting: 'SECRETS_KEY_FILE', file, madeByTheServer: true };
}

function named(file: string, setting = 'SECRETS_KEY_FILE'): SecretsKeyGiven {
  return { from: 'file', setting, file, madeByTheServer: false };
}

function bytesOfTheKeyIn(source: SecretsKeySource): readonly number[] {
  return [...Redacted.value(secretsKeysOf({ current: source, previous: undefined }).current)];
}

function refusalOf(source: SecretsKeySource): string {
  try {
    secretsKeysOf({ current: source, previous: undefined });
  } catch (error) {
    return String(error);
  }
  return 'no refusal';
}

const refusedAs = 'InvalidSettingsError: The secrets settings are invalid.';

describe('the secrets key in the file beside the ledger', () => {
  it('is made at the first start, as the base64 of 32 random bytes only its owner may read, and read at the next', () => {
    const file = join(aFolder(), 'not-yet', 'secrets.key');

    const first = bytesOfTheKeyIn(besideTheLedger(file));
    const written = readFileSync(file, 'utf8');
    const second = bytesOfTheKeyIn(besideTheLedger(file));

    expect(first).toHaveLength(32);
    expect(written).toBe(`${Buffer.from(first).toString('base64')}\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(second).toEqual(first);
    expect(readFileSync(file, 'utf8')).toBe(written);
  });

  it('stops the start when others than its owner may read it, naming the setting, the file and its mode', () => {
    const file = join(aFolder(), 'secrets.key');
    const key = Buffer.alloc(32, 3).toString('base64');
    writeFileSync(file, key, { mode: 0o600 });
    chmodSync(file, 0o644);

    const refusal = refusalOf(besideTheLedger(file));

    expect(refusal).toBe(
      `${refusedAs} SECRETS_KEY_FILE: The key file ${file} has the mode 0644, so others than its owner may read it; set it to 0600`,
    );
    expect(refusal).not.toContain(key);
  });
});

describe('the secrets key in a file a setting names', () => {
  it('is read as the platform mounts it, whoever else may read it, and the previous key from the file its setting names', () => {
    const folder = aFolder();
    const [current, previous] = [join(folder, 'current.key'), join(folder, 'previous.key')];
    writeFileSync(current, Buffer.alloc(32, 3).toString('base64'), { mode: 0o644 });
    writeFileSync(previous, `${Buffer.alloc(32, 4).toString('base64')}\n`, { mode: 0o444 });

    const keys = secretsKeysOf({ current: named(current), previous: named(previous, 'SECRETS_KEY_FILE_PREVIOUS') });

    expect([bytesOf(keys.current), bytesOf(keys.previous)]).toEqual([
      Array.from({ length: 32 }, () => 3),
      Array.from({ length: 32 }, () => 4),
    ]);
  });

  it('stops the start when the user the server runs as cannot read it, naming the setting and the file', () => {
    const file = join(aFolder(), 'secrets.key');
    writeFileSync(file, Buffer.alloc(32, 3).toString('base64'), { mode: 0o600 });
    chmodSync(file, 0o000);

    expect([refusalOf(named(file)), refusalOf(named(file, 'SECRETS_KEY_FILE_PREVIOUS'))]).toEqual([
      `${refusedAs} SECRETS_KEY_FILE: The key file ${file} cannot be read by the user the server runs as`,
      `${refusedAs} SECRETS_KEY_FILE_PREVIOUS: The key file ${file} cannot be read by the user the server runs as`,
    ]);
  });

  it('stops the start when it does not exist, naming the setting and the file, and makes none', () => {
    const file = join(aFolder(), 'mounted', 'secrets.key');

    expect([refusalOf(named(file)), refusalOf(named(file, 'SECRETS_KEY_FILE_PREVIOUS'))]).toEqual([
      `${refusedAs} SECRETS_KEY_FILE: The key file ${file} does not exist, and a key file a setting names is read, never made`,
      `${refusedAs} SECRETS_KEY_FILE_PREVIOUS: The key file ${file} does not exist, and a key file a setting names is read, never made`,
    ]);
    expect(existsSync(file)).toBe(false);
  });

  it.each([
    ['16 bytes', Buffer.alloc(16, 3).toString('base64')],
    ['no base64', 'a key'],
    ['nothing', ''],
  ])('stops the start when it holds %s, naming the setting and the file and never what it holds', (_, held) => {
    const file = join(aFolder(), 'secrets.key');
    writeFileSync(file, held, { mode: 0o600 });

    expect(refusalOf(named(file))).toBe(
      `${refusedAs} SECRETS_KEY_FILE: The key file ${file} holds something other than the base64 of 32 bytes, as openssl rand -base64 32 prints it`,
    );
  });
});

describe('the secrets keys of the other settings', () => {
  it('are the keys SECRETS_KEY and SECRETS_KEY_PREVIOUS give, or a key made at each start', () => {
    const [current, previous] = [Redacted.make(new Uint8Array(32)), Redacted.make(new Uint8Array(32).fill(1))];

    const given = secretsKeysOf({
      current: { from: 'environment', setting: 'SECRETS_KEY', key: current },
      previous: { from: 'environment', setting: 'SECRETS_KEY_PREVIOUS', key: previous },
    });
    const [first, second] = [1, 2].map(() =>
      Array.from(Redacted.value(secretsKeysOf({ current: { from: 'start' }, previous: undefined }).current)),
    );

    expect(given).toEqual({ current, previous });
    expect([first?.length, second?.length]).toEqual([32, 32]);
    expect(first).not.toEqual(second);
  });
});

function bytesOf(key: Redacted.Redacted<Uint8Array> | undefined): readonly number[] {
  return key === undefined ? [] : Array.from(Redacted.value(key));
}

function derivedOf(bytes: Readonly<Uint8Array>): readonly number[] {
  return bytesOf(retryStateKeysOf({ current: Redacted.make(Uint8Array.from(bytes)) }).current);
}

describe('the key that signs the state of a retry', () => {
  it('is derived from the current secrets key, the same of the same key, and never the key itself', () => {
    const key = new Uint8Array(32).fill(7);

    const [first, again, ofAnother] = [derivedOf(key), derivedOf(key), derivedOf(new Uint8Array(32).fill(9))];

    expect(first).toHaveLength(32);
    expect(again).toEqual(first);
    expect(ofAnother).not.toEqual(first);
    expect(first).not.toEqual(Array.from(key));
  });

  it('is derived from the previous secrets key too, as a server that still has it as its current derives it', () => {
    const [previous, current] = [new Uint8Array(32).fill(7), new Uint8Array(32).fill(9)];

    const rotating = retryStateKeysOf({ current: Redacted.make(current), previous: Redacted.make(previous) });

    expect([bytesOf(rotating.current), bytesOf(rotating.previous)]).toEqual([derivedOf(current), derivedOf(previous)]);
    expect(bytesOf(retryStateKeysOf({ current: Redacted.make(current) }).previous)).toEqual([]);
  });
});
