import { statement, type Dialect, type Statement } from '@on.auto/ledger';

function historyGuards(dialect: Dialect): readonly Statement[] {
  if (dialect === 'sqlite')
    return [
      statement`CREATE TRIGGER IF NOT EXISTS meter_license_history_no_update BEFORE UPDATE ON meter_license_history
      BEGIN SELECT RAISE(ABORT, 'License history is immutable'); END`,
      statement`CREATE TRIGGER IF NOT EXISTS meter_license_history_no_delete BEFORE DELETE ON meter_license_history
      BEGIN SELECT RAISE(ABORT, 'License history is immutable'); END`,
      statement`CREATE TRIGGER IF NOT EXISTS meter_license_history_no_replace BEFORE INSERT ON meter_license_history
      WHEN EXISTS (SELECT 1 FROM meter_license_history WHERE serial = NEW.serial OR generation = NEW.generation)
      BEGIN SELECT RAISE(ABORT, 'License history is immutable'); END`,
    ];
  return [
    statement`CREATE OR REPLACE FUNCTION meter_license_history_immutable() RETURNS TRIGGER LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'License history is immutable'; END $$`,
    statement`CREATE OR REPLACE TRIGGER meter_license_history_no_change BEFORE UPDATE OR DELETE OR TRUNCATE ON meter_license_history
      FOR EACH STATEMENT EXECUTE FUNCTION meter_license_history_immutable()`,
  ];
}

export function licenseStateSchema(dialect: Dialect): readonly Statement[] {
  return [
    statement`CREATE TABLE IF NOT EXISTS meter_license_head (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision BIGINT NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
      generation BIGINT NOT NULL CHECK (generation BETWEEN 0 AND 9007199254740991),
      state TEXT NOT NULL CHECK (state IN ('unlicensed', 'active', 'refused')),
      account_id TEXT, installation_id TEXT, serial TEXT, attempt_id TEXT,
      CHECK ((state = 'unlicensed' AND generation = 0 AND account_id IS NULL AND installation_id IS NULL AND serial IS NULL)
        OR (state <> 'unlicensed' AND generation > 0 AND account_id IS NOT NULL AND installation_id IS NOT NULL AND serial IS NOT NULL))
    )`,
    statement`INSERT INTO meter_license_head (id, revision, generation, state) VALUES (1, 0, 0, 'unlicensed') ON CONFLICT (id) DO NOTHING`,
    statement`CREATE TABLE IF NOT EXISTS meter_license_history (
      serial TEXT PRIMARY KEY, generation BIGINT NOT NULL UNIQUE CHECK (generation BETWEEN 1 AND 9007199254740991),
      revision BIGINT NOT NULL UNIQUE CHECK (revision BETWEEN 1 AND 9007199254740991),
      token TEXT NOT NULL, challenge_payload TEXT NOT NULL, allocation_json TEXT NOT NULL,
      accepted_at BIGINT NOT NULL CHECK (accepted_at BETWEEN 0 AND 8640000000000000)
    )`,
    ...historyGuards(dialect),
  ];
}
