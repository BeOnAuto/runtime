import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { Dialect } from '../connection/ledger-connection.ts';
import { storedDataOf } from '../postgresql/json-text.ts';

export interface LayoutDialect {
  readonly dialect: Dialect;
  readonly tablesOfTheSchema: () => SQL;
  readonly storedData: (column: unknown) => unknown;
  readonly storedMetadata: (column: unknown) => unknown;
}

const decodeJsonText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

export const sqliteLayout: LayoutDialect = {
  dialect: 'sqlite',
  tablesOfTheSchema: () => SQL`SELECT name FROM sqlite_master WHERE type = 'table'`,
  storedData: decodeJsonText,
  storedMetadata: decodeJsonText,
};

export const postgresqlLayout: LayoutDialect = {
  dialect: 'postgresql',
  tablesOfTheSchema: () => SQL`SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()`,
  storedData: storedDataOf,
  storedMetadata: (column) => column,
};
