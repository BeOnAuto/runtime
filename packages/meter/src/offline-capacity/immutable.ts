import { statement, type Dialect, type Statement } from '@on.auto/ledger';

export function immutableCapacity(dialect: Dialect): readonly Statement[] {
  if (dialect === 'sqlite')
    return [
      statement`CREATE TRIGGER IF NOT EXISTS meter_capacity_history_no_update BEFORE UPDATE ON meter_capacity_history
      BEGIN SELECT RAISE(ABORT, 'Offline capacity evidence is immutable'); END`,
      statement`CREATE TRIGGER IF NOT EXISTS meter_capacity_history_no_delete BEFORE DELETE ON meter_capacity_history
      BEGIN SELECT RAISE(ABORT, 'Offline capacity evidence is immutable'); END`,
      statement`CREATE TRIGGER IF NOT EXISTS meter_capacity_history_no_replace BEFORE INSERT ON meter_capacity_history
      WHEN EXISTS (SELECT 1 FROM meter_capacity_history WHERE id = NEW.id OR epoch = NEW.epoch OR token_digest = NEW.token_digest)
      BEGIN SELECT RAISE(ABORT, 'Offline capacity evidence is immutable'); END`,
      statement`CREATE TRIGGER IF NOT EXISTS meter_capacity_sources_no_update BEFORE UPDATE ON meter_capacity_sources
      BEGIN SELECT RAISE(ABORT, 'Offline capacity evidence is immutable'); END`,
      statement`CREATE TRIGGER IF NOT EXISTS meter_capacity_sources_no_delete BEFORE DELETE ON meter_capacity_sources
      BEGIN SELECT RAISE(ABORT, 'Offline capacity evidence is immutable'); END`,
      statement`CREATE TRIGGER IF NOT EXISTS meter_capacity_sources_no_replace BEFORE INSERT ON meter_capacity_sources
      WHEN EXISTS (SELECT 1 FROM meter_capacity_sources WHERE allocation_id = NEW.allocation_id AND lot_id = NEW.lot_id)
      BEGIN SELECT RAISE(ABORT, 'Offline capacity evidence is immutable'); END`,
    ];
  return [
    statement`CREATE OR REPLACE FUNCTION meter_capacity_immutable() RETURNS TRIGGER LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'Offline capacity evidence is immutable'; END $$`,
    statement`CREATE OR REPLACE TRIGGER meter_capacity_history_no_change BEFORE UPDATE OR DELETE OR TRUNCATE ON meter_capacity_history
      FOR EACH STATEMENT EXECUTE FUNCTION meter_capacity_immutable()`,
    statement`CREATE OR REPLACE TRIGGER meter_capacity_sources_no_change BEFORE UPDATE OR DELETE OR TRUNCATE ON meter_capacity_sources
      FOR EACH STATEMENT EXECUTE FUNCTION meter_capacity_immutable()`,
  ];
}
