import { statementOf, type Dialect, type Statement } from '@on.auto/ledger';

export function immutableMeterRows(dialect: Dialect, table: string, duplicate: string): readonly Statement[] {
  if (dialect === 'sqlite')
    return [
      statementOf(
        [
          `CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
        BEGIN SELECT RAISE(ABORT, 'Offline accounting evidence is immutable'); END`,
        ],
        [],
      ),
      statementOf(
        [
          `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
        BEGIN SELECT RAISE(ABORT, 'Offline accounting evidence is immutable'); END`,
        ],
        [],
      ),
      statementOf(
        [
          `CREATE TRIGGER IF NOT EXISTS ${table}_no_replace BEFORE INSERT ON ${table}
        WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${duplicate})
        BEGIN SELECT RAISE(ABORT, 'Offline accounting evidence is immutable'); END`,
        ],
        [],
      ),
    ];
  return [
    statementOf(
      [
        `CREATE OR REPLACE FUNCTION meter_accounting_immutable() RETURNS TRIGGER LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'Offline accounting evidence is immutable'; END $$`,
      ],
      [],
    ),
    statementOf(
      [
        `CREATE OR REPLACE TRIGGER ${table}_no_change BEFORE UPDATE OR DELETE OR TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION meter_accounting_immutable()`,
      ],
      [],
    ),
  ];
}
