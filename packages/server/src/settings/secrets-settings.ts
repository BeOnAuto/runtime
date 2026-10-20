import type { Environment } from '@on.auto/config';
import { secretKeyBytes } from '@on.auto/secrets';
import { Config, ConfigProvider, Effect, Option, Redacted } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';
import { besideTheLedgerFile, readLedgerSettings, type LedgerSettings } from './ledger-settings.ts';

export interface SecretKeys {
  readonly current: Redacted.Redacted<Uint8Array>;
  readonly previous?: Redacted.Redacted<Uint8Array> | undefined;
}

export type SecretsSettings =
  | { readonly key: 'set'; readonly keys: SecretKeys }
  | { readonly key: 'in-a-file'; readonly file: string }
  | { readonly key: 'made-at-start' };

export interface LedgerAndSecrets {
  readonly ledger: LedgerSettings;
  readonly secrets: SecretsSettings;
}

export const secretsVariables: readonly string[] = ['SECRETS_KEY', 'SECRETS_KEY_PREVIOUS'];

const sources = Config.all({
  current: Config.option(Config.Redacted('SECRETS_KEY')),
  previous: Config.option(Config.Redacted('SECRETS_KEY_PREVIOUS')),
});

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

function keyIn(
  variable: string,
  given: Redacted.Redacted,
): Effect.Effect<Redacted.Redacted<Uint8Array>, InvalidSettingsError> {
  const key = secretsKeyOfBase64(Redacted.value(given));
  return key === undefined ? Effect.fail(invalid(`${variable}: Expected ${aSecretsKeyInWords}`)) : Effect.succeed(key);
}

function withoutAKey(ledger: LedgerSettings): Effect.Effect<SecretsSettings, InvalidSettingsError> {
  if (ledger.store === 'postgresql') {
    return Effect.fail(
      invalid(
        'SECRETS_KEY: Set it when the ledger is kept in PostgreSQL, since a database that runtimes share needs a key kept on none of their disks',
      ),
    );
  }
  const file = besideTheLedgerFile(ledger, keyFileName);
  return Effect.succeed(file === undefined ? { key: 'made-at-start' } : { key: 'in-a-file', file });
}

function readSecretsSettings(
  environment: Environment,
  ledger: LedgerSettings,
): Effect.Effect<SecretsSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const { current, previous } = yield* Effect.orDie(sources.parse(ConfigProvider.fromEnvRecord(environment)));
    if (Option.isNone(current)) {
      return Option.isNone(previous)
        ? yield* withoutAKey(ledger)
        : yield* Effect.fail(
            invalid('SECRETS_KEY_PREVIOUS: Set it only beside SECRETS_KEY, to the key that SECRETS_KEY replaces'),
          );
    }
    const keys: SecretKeys = {
      current: yield* keyIn('SECRETS_KEY', current.value),
      previous: Option.isSome(previous) ? yield* keyIn('SECRETS_KEY_PREVIOUS', previous.value) : undefined,
    };
    const set: SecretsSettings = { key: 'set', keys };
    return set;
  });
}

export function readLedgerAndSecrets(environment: Environment): Effect.Effect<LedgerAndSecrets, InvalidSettingsError> {
  return Effect.flatMap(readLedgerSettings(environment), (ledger) =>
    Effect.map(readSecretsSettings(environment, ledger), (secrets) => ({ ledger, secrets })),
  );
}
