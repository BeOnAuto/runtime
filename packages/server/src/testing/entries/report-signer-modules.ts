import { createRequire } from 'node:module';

import { Option, Schema } from 'effect';

import { databasePoolsOf } from '../../database/database-pools.ts';
import type { LedgerSettings, PostgreSQLLedgerSettings } from '../../settings/ledger-settings.ts';
import { readSettingsOf } from '../settings/shipped-settings.ts';

function isInPostgreSQL(ledger: Readonly<LedgerSettings>): ledger is PostgreSQLLedgerSettings {
  return ledger.store === 'postgresql';
}

const environment = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))(
  process.argv[2],
);
const { ledger, proxy } = readSettingsOf(environment);
const pool = databasePoolsOf(Option.getOrThrow(Option.liftPredicate(ledger, isInPostgreSQL)), proxy)({ max: 1 });
await pool.end();

const modulesOfTheSigner = Object.keys(createRequire(import.meta.url).cache).filter((path) =>
  path.includes('/@aws-sdk/rds-signer/'),
);
process.stdout.write(JSON.stringify(modulesOfTheSigner));
