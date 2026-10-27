import { statement, type Dialect, type Statement } from '@on.auto/ledger';

import { immutableMeterRows } from '../database/immutable-rows.ts';

export function offlineReservationSchema(dialect: Dialect): readonly Statement[] {
  return [
    statement`CREATE TABLE IF NOT EXISTS meter_reservations (
      id TEXT PRIMARY KEY, allocation_id TEXT NOT NULL REFERENCES meter_capacity_history(id),
      context_json TEXT NOT NULL, quote_id TEXT NOT NULL, capabilities_json TEXT NOT NULL,
      maximum_units BIGINT NOT NULL CHECK (maximum_units BETWEEN 1 AND 9007199254740991),
      admitted_at BIGINT NOT NULL CHECK (admitted_at BETWEEN 0 AND 8640000000000000),
      dispatch_before BIGINT NOT NULL CHECK (dispatch_before > admitted_at),
      UNIQUE (id, allocation_id)
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_reservation_state (
      id TEXT PRIMARY KEY REFERENCES meter_reservations(id),
      state TEXT NOT NULL CHECK (state IN ('held', 'running', 'settled'))
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_reservation_sources (
      reservation_id TEXT NOT NULL, allocation_id TEXT NOT NULL, lot_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 63),
      units BIGINT NOT NULL CHECK (units BETWEEN 1 AND 9007199254740991),
      PRIMARY KEY (reservation_id, lot_id), UNIQUE (reservation_id, lot_id, units), UNIQUE (reservation_id, position),
      FOREIGN KEY (reservation_id, allocation_id) REFERENCES meter_reservations(id, allocation_id),
      FOREIGN KEY (allocation_id, lot_id) REFERENCES meter_capacity_sources(allocation_id, lot_id)
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_reservation_usage (
      reservation_id TEXT NOT NULL, lot_id TEXT NOT NULL, capacity_units BIGINT NOT NULL,
      reserved_units BIGINT NOT NULL CHECK (reserved_units >= 0),
      committed_units BIGINT NOT NULL CHECK (committed_units >= 0),
      released_units BIGINT NOT NULL CHECK (released_units >= 0),
      CHECK (reserved_units + committed_units + released_units = capacity_units),
      PRIMARY KEY (reservation_id, lot_id),
      FOREIGN KEY (reservation_id, lot_id, capacity_units) REFERENCES meter_reservation_sources(reservation_id, lot_id, units)
    )`,
    ...immutableMeterRows(dialect, 'meter_reservations', 'id = NEW.id'),
    ...immutableMeterRows(
      dialect,
      'meter_reservation_sources',
      'reservation_id = NEW.reservation_id AND (lot_id = NEW.lot_id OR position = NEW.position)',
    ),
  ];
}
