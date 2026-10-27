import { statement, type Dialect, type Statement } from '@on.auto/ledger';

import { immutableCapacity } from './immutable.ts';

export function capacitySchema(dialect: Dialect): readonly Statement[] {
  return [
    statement`CREATE TABLE IF NOT EXISTS meter_capacity_head (
      id INTEGER PRIMARY KEY CHECK (id = 1), revision BIGINT NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
      last_epoch BIGINT NOT NULL CHECK (last_epoch BETWEEN 0 AND 9007199254740991), current_id TEXT, attempt_id TEXT,
      CHECK ((last_epoch = 0 AND current_id IS NULL) OR (last_epoch > 0 AND current_id IS NOT NULL))
    )`,
    statement`INSERT INTO meter_capacity_head (id, revision, last_epoch) VALUES (1, 0, 0) ON CONFLICT (id) DO NOTHING`,
    statement`CREATE TABLE IF NOT EXISTS meter_capacity_history (
      id TEXT PRIMARY KEY, epoch BIGINT NOT NULL UNIQUE CHECK (epoch BETWEEN 1 AND 9007199254740991),
      token_digest TEXT NOT NULL UNIQUE, token TEXT NOT NULL CHECK (length(token) BETWEEN 1 AND 65536),
      claims_json TEXT NOT NULL
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_capacity_state (
      id TEXT PRIMARY KEY REFERENCES meter_capacity_history(id),
      revision BIGINT NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
      state TEXT NOT NULL CHECK (state IN ('open', 'closing', 'closed', 'quarantined')), checkpoint TEXT NOT NULL,
      attempt_id TEXT,
      report_sequence BIGINT NOT NULL DEFAULT 0 CHECK (report_sequence BETWEEN 0 AND 9007199254740991),
      reported_revision BIGINT NOT NULL DEFAULT 0 CHECK (reported_revision BETWEEN 0 AND revision)
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_capacity_sources (
      allocation_id TEXT NOT NULL REFERENCES meter_capacity_history(id), lot_id TEXT NOT NULL,
      units BIGINT NOT NULL CHECK (units BETWEEN 1 AND 9007199254740991),
      PRIMARY KEY (allocation_id, lot_id), UNIQUE (allocation_id, lot_id, units)
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_capacity_usage (
      allocation_id TEXT NOT NULL, lot_id TEXT NOT NULL, capacity_units BIGINT NOT NULL,
      reserved_units BIGINT NOT NULL CHECK (reserved_units >= 0), committed_units BIGINT NOT NULL CHECK (committed_units >= 0),
      CHECK (reserved_units + committed_units <= capacity_units), PRIMARY KEY (allocation_id, lot_id),
      FOREIGN KEY (allocation_id, lot_id, capacity_units) REFERENCES meter_capacity_sources(allocation_id, lot_id, units)
    )`,
    ...immutableCapacity(dialect),
  ];
}
