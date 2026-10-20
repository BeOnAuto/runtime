import type { Environment } from '@on.auto/config';
import { secretKeyBytes } from '@on.auto/secrets';
import { Config, ConfigProvider, Effect, Option, Redacted } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';
import { besideTheLedgerFile, readLedgerSettings, type LedgerSettings } from './ledger-settings.ts';

export type SecretsKeyGiven =
  | { readonly from: 'environment'; readonly setting: string; readonly key: Redacted.Redacted<Uint8Array> }
  | { readonly from: 'file'; readonly setting: string; readonly file: string; readonly madeByTheServer: boolean };

export type SecretsKeySource = SecretsKeyGiven | { readonly from: 'start' };

export interface SecretsSettings {
  readonly current: SecretsKeySource;
  readonly previous: SecretsKeyGiven | undefined;
}

export interface LedgerAndSecrets {
  readonly ledger: LedgerSettings;
  readonly secrets: SecretsSettings;
}

interface KeySettings {
  readonly key: string;
  readonly file: string;
}

const currentKey: KeySettings = { key: 'SECRETS_KEY', file: 'SECRETS_KEY_FILE' };

const previousKey: KeySettings = { key: 'SECRETS_KEY_PREVIOUS', file: 'SECRETS_KEY_FILE_PREVIOUS' };

export const secretsVariables: readonly string[] = [currentKey, previousKey].flatMap(({ key, file }) => [key, file]);

function sourcesOf({ key, file }: KeySettings) {
  return Config.all({
    key: Config.map(Config.option(Config.Redacted(key)), Option.getOrUndefined),
    file: Config.map(Config.option(Config.String(file)), Option.getOrUndefined),
  });
}

const sources = Config.all({ current: sourcesOf(currentKey), previous: sourcesOf(previousKey) });

interface Given {
  readonly key: Redacted.Redacted | undefined;
  readonly file: string | undefined;
}

const keyFileName = 'secrets.key';

export const aSecretsKeyInWords = `the base64 of ${secretKeyBytes} bytes, as openssl rand -base64 ${secretKeyBytes} prints it`;

function invalid(detail: string): InvalidSettingsError {
  return new InvalidSettingsError({ message: `The secrets settings are invalid. ${detail}` });
}

export function secretsKeyOfBase64(text: string): Redacted.Redacted<Uint8Array> | undefined {
  const base64 = text.trim();
  const bytes = Buffer.from(base64, 'base64');
  return bytes.byteLength === secretKeyBytes && bytes.toString('base64') === base64
    ? Redacted.make(Uint8Array.from(bytes))
    : undefined;
}

function keyIn(setting: string, given: Redacted.Redacted): Effect.Effect<SecretsKeyGiven, InvalidSettingsError> {
  const key = secretsKeyOfBase64(Redacted.value(given));
  return key === undefined
    ? Effect.fail(invalid(`${setting}: Expected ${aSecretsKeyInWords}`))
    : Effect.succeed({ from: 'environment', setting, key });
}

function sourceGiven(
  settings: KeySettings,
  { key, file }: Given,
): Effect.Effect<SecretsKeyGiven | undefined, InvalidSettingsError> {
  if (key !== undefined && file !== undefined) {
    return Effect.fail(invalid(`${settings.key}: Set ${settings.key} or ${settings.file}, not both`));
  }
  if (key !== undefined) {
    return keyIn(settings.key, key);
  }
  return Effect.succeed(
    file === undefined ? undefined : { from: 'file', setting: settings.file, file, madeByTheServer: false },
  );
}

function withoutAKey(ledger: LedgerSettings): Effect.Effect<SecretsKeySource, InvalidSettingsError> {
  if (ledger.store === 'postgresql') {
    return Effect.fail(
      invalid(
        'SECRETS_KEY: Set it, or SECRETS_KEY_FILE, when the ledger is kept in PostgreSQL, since a database that runtimes share needs a key kept on none of their disks',
      ),
    );
  }
  const file = besideTheLedgerFile(ledger, keyFileName);
  return Effect.succeed(
    file === undefined ? { from: 'start' } : { from: 'file', setting: currentKey.file, file, madeByTheServer: true },
  );
}

function previousAlone({ setting }: SecretsKeyGiven): InvalidSettingsError {
  return invalid(
    `${setting}: Set it only beside ${currentKey.key} or ${currentKey.file}, to the key that one replaces`,
  );
}

function readSecretsSettings(
  environment: Environment,
  ledger: LedgerSettings,
): Effect.Effect<SecretsSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const given = yield* Effect.orDie(sources.parse(ConfigProvider.fromEnvRecord(environment)));
    const current = yield* sourceGiven(currentKey, given.current);
    const previous = yield* sourceGiven(previousKey, given.previous);
    if (current !== undefined) {
      return { current, previous };
    }
    return previous === undefined
      ? { current: yield* withoutAKey(ledger), previous }
      : yield* Effect.fail(previousAlone(previous));
  });
}

export function readLedgerAndSecrets(environment: Environment): Effect.Effect<LedgerAndSecrets, InvalidSettingsError> {
  return Effect.flatMap(readLedgerSettings(environment), (ledger) =>
    Effect.map(readSecretsSettings(environment, ledger), (secrets) => ({ ledger, secrets })),
  );
}
