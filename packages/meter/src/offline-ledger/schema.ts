import { statement, type Dialect, type Statement } from '@on.auto/ledger';

import { immutableMeterRows } from '../database/immutable-rows.ts';

export function offlineLedgerSchema(dialect: Dialect): readonly Statement[] {
  return [
    statement`CREATE TABLE IF NOT EXISTS meter_local_commands (
      id TEXT PRIMARY KEY, payload_digest TEXT NOT NULL,
      allocation_id TEXT NOT NULL REFERENCES meter_capacity_history(id), reservation_id TEXT NOT NULL,
      revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
      kind TEXT NOT NULL CHECK (kind IN ('reserve', 'dispatch', 'release')),
      units BIGINT NOT NULL CHECK (units BETWEEN 0 AND 9007199254740991),
      occurred_at BIGINT NOT NULL CHECK (occurred_at BETWEEN 0 AND 8640000000000000),
      UNIQUE (allocation_id, revision), UNIQUE (id, allocation_id)
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_local_entries (
      command_id TEXT NOT NULL, allocation_id TEXT NOT NULL, lot_id TEXT NOT NULL,
      reserved_delta BIGINT NOT NULL CHECK (reserved_delta BETWEEN -9007199254740991 AND 9007199254740991),
      committed_delta BIGINT NOT NULL CHECK (committed_delta BETWEEN 0 AND 9007199254740991),
      PRIMARY KEY (command_id, lot_id),
      FOREIGN KEY (command_id, allocation_id) REFERENCES meter_local_commands(id, allocation_id),
      FOREIGN KEY (allocation_id, lot_id) REFERENCES meter_capacity_sources(allocation_id, lot_id)
    )`,
    ...immutableMeterRows(
      dialect,
      'meter_local_commands',
      'id = NEW.id OR (allocation_id = NEW.allocation_id AND revision = NEW.revision)',
    ),
    ...immutableMeterRows(dialect, 'meter_local_entries', 'command_id = NEW.command_id AND lot_id = NEW.lot_id'),
  ];
}
