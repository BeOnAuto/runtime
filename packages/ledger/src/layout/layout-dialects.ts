import { SQL } from '@event-driven-io/dumbo';

export interface LayoutDialect {
  readonly tablesOfTheSchema: () => SQL;
}

export const sqliteLayout: LayoutDialect = {
  tablesOfTheSchema: () => SQL`SELECT name FROM sqlite_master WHERE type = 'table'`,
};

export const postgresqlLayout: LayoutDialect = {
  tablesOfTheSchema: () => SQL`SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()`,
};
