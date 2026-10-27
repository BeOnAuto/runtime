import { statement, type Dialect, type Statement } from '@on.auto/ledger';

export function clockReceiptGuards(dialect: Dialect): readonly Statement[] {
  if (dialect === 'sqlite')
    return [
      statement`CREATE TRIGGER IF NOT EXISTS meter_clock_refreshes_no_update BEFORE UPDATE ON meter_clock_refreshes
      BEGIN SELECT RAISE(ABORT, 'Clock refresh receipts are immutable'); END`,
      statement`CREATE TRIGGER IF NOT EXISTS meter_clock_refreshes_no_delete BEFORE DELETE ON meter_clock_refreshes
      BEGIN SELECT RAISE(ABORT, 'Clock refresh receipts are immutable'); END`,
      statement`CREATE TRIGGER IF NOT EXISTS meter_clock_refreshes_no_replace BEFORE INSERT ON meter_clock_refreshes
      WHEN EXISTS (SELECT 1 FROM meter_clock_refreshes WHERE id = NEW.id)
      BEGIN SELECT RAISE(ABORT, 'Clock refresh receipts are immutable'); END`,
    ];
  return [
    statement`CREATE OR REPLACE FUNCTION meter_clock_refreshes_immutable() RETURNS TRIGGER LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'Clock refresh receipts are immutable'; END $$`,
    statement`CREATE OR REPLACE TRIGGER meter_clock_refreshes_no_change
      BEFORE UPDATE OR DELETE OR TRUNCATE ON meter_clock_refreshes
      FOR EACH STATEMENT EXECUTE FUNCTION meter_clock_refreshes_immutable()`,
  ];
}
