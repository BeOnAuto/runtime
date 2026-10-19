import { dirname, join } from 'node:path';

import type { Environment } from '@on.auto/config';
import { Config, ConfigProvider, Effect, Option, Redacted } from 'effect';

import {
  credentialsKindOf,
  credentialsOf,
  type CredentialsKind,
  type DatabaseCredentials,
} from './database-credentials.ts';
import { InvalidSettingsError } from './invalid-settings-error.ts';

export interface PostgreSQLLedgerSettings {
  readonly store: 'postgresql';
  readonly url: Redacted.Redacted;
  readonly host: string;
  readonly database: string;
  readonly credentials: DatabaseCredentials;
}

export type LedgerSettings = { readonly store: 'sqlite'; readonly file: string } | PostgreSQLLedgerSettings;

const defaultFile = 'data/ledger.db';

export const privateMemory = ':memory:';

export function besideTheLedgerFile(ledger: LedgerSettings, name: string): string | undefined {
  return ledger.store === 'sqlite' && ledger.file !== privateMemory ? join(dirname(ledger.file), name) : undefined;
}

const postgresqlSchemes: ReadonlySet<string> = new Set(['postgres:', 'postgresql:']);

export const ledgerVariables: readonly string[] = ['LEDGER_FILE', 'DATABASE_URL', 'DATABASE_CREDENTIALS', 'AWS_REGION'];

const sources = Config.all({
  file: Config.option(Config.String('LEDGER_FILE')),
  url: Config.option(Config.Redacted('DATABASE_URL')),
  credentials: Config.option(Config.String('DATABASE_CREDENTIALS')),
  region: Config.option(Config.String('AWS_REGION')),
});

function invalid(detail: string): InvalidSettingsError {
  return new InvalidSettingsError({ message: `The ledger settings are invalid. ${detail}` });
}

function databaseNameIn(pathname: string): string {
  try {
    return decodeURI(pathname.slice(1));
  } catch {
    return '';
  }
}

function onPostgreSQL(
  given: Redacted.Redacted,
  kind: CredentialsKind,
  region?: string,
): Effect.Effect<LedgerSettings, InvalidSettingsError> {
  const url = Redacted.value(given).trim();
  const parsed = URL.parse(url);
  const database = parsed === null ? '' : databaseNameIn(parsed.pathname);
  return parsed !== null && postgresqlSchemes.has(parsed.protocol) && parsed.host !== '' && database !== ''
    ? credentialsOf(kind, parsed, region).pipe(
        Effect.mapError(invalid),
        Effect.map((credentials) => ({
          store: 'postgresql',
          url: Redacted.make(url),
          host: parsed.host,
          database,
          credentials,
        })),
      )
    : Effect.fail(
        invalid('DATABASE_URL: Expected a PostgreSQL URL such as postgresql://user:password@host:5432/database'),
      );
}

function onSQLite(kind: CredentialsKind, file = defaultFile): Effect.Effect<LedgerSettings, InvalidSettingsError> {
  return kind === 'url'
    ? Effect.succeed({ store: 'sqlite', file })
    : Effect.fail(
        invalid('DATABASE_CREDENTIALS: aws-iam signs the password of a PostgreSQL connection, so set DATABASE_URL'),
      );
}

export function readLedgerSettings(environment: Environment): Effect.Effect<LedgerSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const { file, url, credentials, region } = yield* Effect.orDie(
      sources.parse(ConfigProvider.fromEnvRecord(environment)),
    );
    const kind = yield* Effect.mapError(credentialsKindOf(Option.getOrUndefined(credentials)), invalid);
    if (Option.isSome(file) && Option.isSome(url)) {
      return yield* Effect.fail(invalid('DATABASE_URL: Set DATABASE_URL or LEDGER_FILE, not both'));
    }
    return yield* Option.match(url, {
      onNone: () => onSQLite(kind, Option.getOrUndefined(file)),
      onSome: (given) => onPostgreSQL(given, kind, Option.getOrUndefined(region)),
    });
  });
}
