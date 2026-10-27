import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

const key = 'alk.acme.0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.c2VjcmV0';

function configFile(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-license-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

const refusals: readonly (readonly [string, Readonly<Record<string, string>>, string])[] = [
  ['a key that is not one of Studio', { AUTO_RUNTIME_LICENSE_KEY: 'ak_one_two' }, 'alk.<org>.<installation>.<secret>'],
  [
    'an account service that is no origin',
    { ACCOUNTS_ORIGIN: 'https://accounts.example.com/v1' },
    'Expected the origin',
  ],
  [
    'an account service over http off the loopback',
    { ACCOUNTS_ORIGIN: 'http://accounts.example.com' },
    'ACCOUNTS_ORIGIN: Expected an https URL',
  ],
];

describe('the license settings', () => {
  it('hold no key, and Auto’s account service, when nothing sets them', () => {
    expect(readSettingsOf({}).license).toEqual({ key: undefined, accounts: 'https://accounts.on.auto' });
  });

  it('read the key from AUTO_RUNTIME_LICENSE_KEY and another account service from ACCOUNTS_ORIGIN', () => {
    expect(
      readSettingsOf({ AUTO_RUNTIME_LICENSE_KEY: key, ACCOUNTS_ORIGIN: 'http://127.0.0.1:19720' }).license,
    ).toEqual({ key, accounts: 'http://127.0.0.1:19720' });
  });

  it('read the key from license.key of the configuration file, a reference to the variable that holds it', () => {
    const path = configFile('license:\n  key: ${ACME_LICENSE_KEY}\n');

    expect(readSettingsOf({ CONFIG_FILE: path, ACME_LICENSE_KEY: key }).license.key).toBe(key);
    expect(
      readSettingsOf({ CONFIG_FILE: path, ACME_LICENSE_KEY: key, AUTO_RUNTIME_LICENSE_KEY: `${key}2` }).license.key,
    ).toBe(`${key}2`);
  });

  it('refuse a key written out in the configuration file, and one that is not a key of Studio, at its place', () => {
    expect(() => readSettingsOf({ CONFIG_FILE: configFile(`license:\n  key: ${key}\n`) })).toThrow(
      'license.key: Looks like a credential, which this file never holds',
    );
    expect(() => readSettingsOf({ CONFIG_FILE: configFile('license:\n  key: ${KEY}\n'), KEY: 'ak_one_two' })).toThrow(
      'license.key: Expected the key Studio gave as it registered this installation, alk.<org>.<installation>.<secret>',
    );
  });

  it.each(refusals)('refuse %s', (_, environment, words) => {
    expect(() => readSettingsOf(environment)).toThrow(words);
  });
});
