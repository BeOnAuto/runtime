import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { secretKeyBytes } from '@on.auto/secrets';
import { Redacted } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { aSecretsKeyInWords, secretsKeyOfBase64, type SecretsKeySource } from '../settings/secrets-settings.ts';

export type KeyInHand = Exclude<SecretsKeySource, { readonly from: 'kms' }>;

type KeyFile = Extract<SecretsKeySource, { readonly from: 'file' }>;

const ownerOnly = 0o600;

const permissions = 0o777;

const groupAndOthers = 0o077;

function refusedFile({ setting, file }: KeyFile, detail: string): InvalidSettingsError {
  return new InvalidSettingsError({
    message: `The secrets settings are invalid. ${setting}: The key file ${resolve(file)} ${detail}`,
  });
}

function keyWrittenTo(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${randomBytes(secretKeyBytes).toString('base64')}\n`, { mode: ownerOnly, flag: 'wx' });
}

function requireItsOwnerAlone(keyFile: KeyFile): void {
  const mode = statSync(keyFile.file).mode & permissions;
  if ((mode & groupAndOthers) !== 0) {
    throw refusedFile(
      keyFile,
      `has the mode ${mode.toString(8).padStart(4, '0')}, so others than its owner may read it; set it to 0600`,
    );
  }
}

function readableByTheServer(file: string): boolean {
  try {
    accessSync(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function keyReadFrom(keyFile: KeyFile): Redacted.Redacted<Uint8Array> {
  if (keyFile.madeByTheServer) {
    requireItsOwnerAlone(keyFile);
  }
  if (!readableByTheServer(keyFile.file)) {
    throw refusedFile(keyFile, 'cannot be read by the user the server runs as');
  }
  const key = secretsKeyOfBase64(readFileSync(keyFile.file, 'utf8'));
  if (key === undefined) {
    throw refusedFile(keyFile, `holds something other than ${aSecretsKeyInWords}`);
  }
  return key;
}

function keyInFile(keyFile: KeyFile): Redacted.Redacted<Uint8Array> {
  if (!existsSync(keyFile.file)) {
    if (!keyFile.madeByTheServer) {
      throw refusedFile(keyFile, 'does not exist, and a key file a setting names is read, never made');
    }
    keyWrittenTo(keyFile.file);
  }
  return keyReadFrom(keyFile);
}

export function keyInHandOf(source: KeyInHand): Redacted.Redacted<Uint8Array> {
  if (source.from === 'environment') {
    return source.key;
  }
  return source.from === 'file' ? keyInFile(source) : Redacted.make(Uint8Array.from(randomBytes(secretKeyBytes)));
}
