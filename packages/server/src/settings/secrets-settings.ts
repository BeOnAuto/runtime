import type { Environment } from '@on.auto/config';
import { secretKeyBytes } from '@on.auto/secrets';
import { Config, ConfigProvider, Effect, Option, Redacted } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';
import {
  currentKeeper,
  defaultRegion,
  isLedgerNamed,
  keeperVariables,
  previousKeeper,
  readKeeperSettings,
  type KeeperSettings,
} from './keeper-settings.ts';
import { besideTheLedgerFile, ledgerVariables, readLedgerSettings, type LedgerSettings } from './ledger-settings.ts';

type SecretsKeyGiven =
  | { readonly from: 'environment'; readonly setting: string; readonly key: Redacted.Redacted<Uint8Array> }
  | { readonly from: 'file'; readonly setting: string; readonly file: string; readonly madeByTheServer: boolean }
  | { readonly from: 'kms'; readonly setting: string; readonly arn: string; readonly region: string };

export type SecretsKeySource = SecretsKeyGiven | { readonly from: 'start' };

export interface SecretsSettings {
  readonly current: SecretsKeySource;
  readonly previous: SecretsKeyGiven | undefined;
}

export interface LedgerAndSecrets {
  readonly ledger: LedgerSettings;
  readonly secrets: SecretsSettings | undefined;
  readonly keepers: KeeperSettings;
}

interface KeySettings {
  readonly key: string;
  readonly file: string;
  readonly kms: string;
}

const currentKey: KeySettings = { key: 'SECRETS_KEY', file: 'SECRETS_KEY_FILE', kms: 'SECRETS_KEY_KMS' };

const previousKey: KeySettings = {
  key: 'SECRETS_KEY_PREVIOUS',
  file: 'SECRETS_KEY_FILE_PREVIOUS',
  kms: 'SECRETS_KEY_KMS_PREVIOUS',
};

function settingsOf({ key, file, kms }: KeySettings): readonly string[] {
  return [key, file, kms];
}

export const secretsVariables: readonly string[] = [
  ...[currentKey, previousKey].flatMap((settings) => settingsOf(settings)),
  ...keeperVariables,
];

export const ledgerAndSecretsVariables: readonly string[] = [...ledgerVariables, ...secretsVariables, defaultRegion];

function sourcesOf({ key, file, kms }: KeySettings) {
  return Config.all({
    key: Config.map(Config.option(Config.Redacted(key)), Option.getOrUndefined),
    file: Config.map(Config.option(Config.String(file)), Option.getOrUndefined),
    kms: Config.map(Config.option(Config.String(kms)), Option.getOrUndefined),
  });
}

const sources = Config.all({ current: sourcesOf(currentKey), previous: sourcesOf(previousKey) });

interface Given {
  readonly key: Redacted.Redacted | undefined;
  readonly file: string | undefined;
  readonly kms: string | undefined;
}

const keyFileName = 'secrets.key';

const kmsKeyArn =
  /^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d+):\d{12}:(?:key\/(?:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}|mrk-[\da-f]{32})|alias\/[\w/-]+)$/u;

export const aSecretsKeyInWords = `the base64 of ${secretKeyBytes} bytes, as openssl rand -base64 ${secretKeyBytes} prints it`;

const aKmsKeyInWords =
  'the ARN of a symmetric AWS KMS key, arn:aws:kms:<region>:<account>:key/<id>, or of an alias of one, arn:aws:kms:<region>:<account>:alias/<name>';

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

function kmsKeyIn(setting: string, given: string): Effect.Effect<SecretsKeyGiven, InvalidSettingsError> {
  const arn = given.trim();
  const [, region] = kmsKeyArn.exec(arn) ?? [];
  return region === undefined
    ? Effect.fail(invalid(`${setting}: Expected ${aKmsKeyInWords}`))
    : Effect.succeed({ from: 'kms', setting, arn, region });
}

function sourceGiven(
  settings: KeySettings,
  { key, file, kms }: Given,
): Effect.Effect<SecretsKeyGiven | undefined, InvalidSettingsError> {
  const set = [key, file, kms].filter((value) => value !== undefined).length;
  if (set > 1) {
    return Effect.fail(
      invalid(`${settings.key}: Set one of ${settings.key}, ${settings.file} and ${settings.kms}, not more`),
    );
  }
  if (key !== undefined) {
    return keyIn(settings.key, key);
  }
  if (kms !== undefined) {
    return kmsKeyIn(settings.kms, kms);
  }
  return Effect.succeed(
    file === undefined ? undefined : { from: 'file', setting: settings.file, file, madeByTheServer: false },
  );
}

function withoutAKey(ledger: LedgerSettings): Effect.Effect<SecretsKeySource, InvalidSettingsError> {
  if (ledger.store === 'postgresql') {
    return Effect.fail(
      invalid(
        'SECRETS_KEY: Set it, SECRETS_KEY_FILE or SECRETS_KEY_KMS when the ledger is kept in PostgreSQL, since a database that runtimes share needs a key kept on none of their disks',
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
    `${setting}: Set it only beside ${currentKey.key}, ${currentKey.file} or ${currentKey.kms}, to the key that one replaces`,
  );
}

function custodianWithoutTheLedger(setting: string): InvalidSettingsError {
  return invalid(
    `${setting}: Set it only while the ledger keeps secrets, as ${currentKeeper} or ${previousKeeper} names it, since AWS Parameter Store keeps each value under its own encryption and no key of the runtime's`,
  );
}

function settingNamedIn({
  current,
  previous,
}: {
  readonly current: Given;
  readonly previous: Given;
}): string | undefined {
  const named: readonly (readonly [string, unknown])[] = [
    [currentKey.key, current.key],
    [currentKey.file, current.file],
    [currentKey.kms, current.kms],
    [previousKey.key, previous.key],
    [previousKey.file, previous.file],
    [previousKey.kms, previous.kms],
  ];
  return named.find(([, value]) => value !== undefined)?.[0];
}

function readSecretsSettings(
  environment: Environment,
  ledger: LedgerSettings,
  keepers: KeeperSettings,
): Effect.Effect<SecretsSettings | undefined, InvalidSettingsError> {
  return Effect.gen(function* () {
    const given = yield* Effect.orDie(sources.parse(ConfigProvider.fromEnvRecord(environment)));
    if (!isLedgerNamed(keepers)) {
      const named = settingNamedIn(given);
      return named === undefined ? undefined : yield* Effect.fail(custodianWithoutTheLedger(named));
    }
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
  return Effect.gen(function* () {
    const ledger = yield* readLedgerSettings(environment);
    const keepers = yield* readKeeperSettings(environment);
    return { ledger, secrets: yield* readSecretsSettings(environment, ledger, keepers), keepers };
  });
}
