import { statement, type Dialect, type Statement } from '@on.auto/ledger';

import { immutableMeterRows } from '../database/immutable-rows.ts';

export function offlineChargeSchema(dialect: Dialect): readonly Statement[] {
  return [
    statement`CREATE TABLE IF NOT EXISTS meter_offline_charges (
      id TEXT PRIMARY KEY, command_id TEXT NOT NULL UNIQUE, reservation_id TEXT NOT NULL,
      allocation_id TEXT NOT NULL, playbook_id TEXT NOT NULL, run_id TEXT NOT NULL,
      capability TEXT NOT NULL, evidence_digest TEXT NOT NULL,
      admitted_at BIGINT NOT NULL CHECK (admitted_at BETWEEN 0 AND 8640000000000000),
      committed_at BIGINT NOT NULL CHECK (committed_at >= admitted_at AND committed_at <= 8640000000000000),
      UNIQUE (id, allocation_id), FOREIGN KEY (reservation_id, allocation_id) REFERENCES meter_reservations(id, allocation_id),
      FOREIGN KEY (command_id, allocation_id) REFERENCES meter_local_commands(id, allocation_id) DEFERRABLE INITIALLY DEFERRED
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_offline_charge_parts (
      charge_id TEXT NOT NULL, allocation_id TEXT NOT NULL, lot_id TEXT NOT NULL,
      units BIGINT NOT NULL CHECK (units BETWEEN 1 AND 1000000), PRIMARY KEY (charge_id, lot_id),
      FOREIGN KEY (charge_id, allocation_id) REFERENCES meter_offline_charges(id, allocation_id),
      FOREIGN KEY (allocation_id, lot_id) REFERENCES meter_capacity_sources(allocation_id, lot_id)
    )`,
    ...immutableMeterRows(dialect, 'meter_offline_charges', 'id = NEW.id OR command_id = NEW.command_id'),
    ...immutableMeterRows(dialect, 'meter_offline_charge_parts', 'charge_id = NEW.charge_id AND lot_id = NEW.lot_id'),
  ];
}
