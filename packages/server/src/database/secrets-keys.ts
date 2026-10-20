import { hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { RetryStateKeys } from '@on.auto/api';
import { secretKeyBytes } from '@on.auto/secrets';
import { Redacted } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import {
  aSecretsKeyInWords,
  secretsKeyOfBase64,
  type SecretKeys,
  type SecretsSettings,
} from '../settings/secrets-settings.ts';

const ownerOnly = 0o600;

const permissions = 0o777;

const groupAndOthers = 0o077;

function refusedFile(file: string, detail: string): InvalidSettingsError {
  return new InvalidSettingsError({
    message: `The secrets settings are invalid. The key file ${resolve(file)} ${detail}`,
  });
}

function keyWrittenTo(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${randomBytes(secretKeyBytes).toString('base64')}\n`, { mode: ownerOnly, flag: 'wx' });
}

function keyReadFrom(file: string): Redacted.Redacted<Uint8Array> {
  const mode = statSync(file).mode & permissions;
  if ((mode & groupAndOthers) !== 0) {
    throw refusedFile(
      file,
      `has the mode ${mode.toString(8).padStart(4, '0')}, so others than its owner may read it; set it to 0600`,
    );
  }
  const key = secretsKeyOfBase64(readFileSync(file, 'utf8'));
  if (key === undefined) {
    throw refusedFile(file, `holds something other than ${aSecretsKeyInWords}`);
  }
  return key;
}

function keyInFile(file: string): Redacted.Redacted<Uint8Array> {
  if (!existsSync(file)) {
    keyWrittenTo(file);
  }
  return keyReadFrom(file);
}

function keyMadeAtStart(): Redacted.Redacted<Uint8Array> {
  return Redacted.make(Uint8Array.from(randomBytes(secretKeyBytes)));
}

const retryStatePurpose = 'auto-runtime: the key that signs the state of a retry of an MCP tool';

function retryStateKeyOf(key: Redacted.Redacted<Uint8Array>): Redacted.Redacted<Uint8Array> {
  const derived = hkdfSync('sha256', Redacted.value(key), new Uint8Array(), retryStatePurpose, secretKeyBytes);
  return Redacted.make(new Uint8Array(derived));
}

export function retryStateKeysOf({ current, previous }: SecretKeys): RetryStateKeys {
  return {
    current: retryStateKeyOf(current),
    previous: previous === undefined ? undefined : retryStateKeyOf(previous),
  };
}

export function secretsKeysOf(secrets: SecretsSettings): SecretKeys {
  if (secrets.key === 'set') {
    return secrets.keys;
  }
  return { current: secrets.key === 'in-a-file' ? keyInFile(secrets.file) : keyMadeAtStart() };
}
