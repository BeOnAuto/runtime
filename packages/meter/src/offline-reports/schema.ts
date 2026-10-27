import { statement, type Dialect, type Statement } from '@on.auto/ledger';

import { immutableMeterRows } from '../database/immutable-rows.ts';

export function offlineReportSchema(dialect: Dialect): readonly Statement[] {
  return [
    statement`CREATE TABLE IF NOT EXISTS meter_local_reports (
      allocation_id TEXT NOT NULL REFERENCES meter_capacity_history(id),
      sequence BIGINT NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
      snapshot_revision BIGINT NOT NULL CHECK (snapshot_revision BETWEEN 0 AND 9007199254740991),
      charge_revision BIGINT NOT NULL CHECK (charge_revision BETWEEN 0 AND snapshot_revision),
      checkpoint TEXT NOT NULL, payload_json TEXT NOT NULL,
      signed_report TEXT NOT NULL CHECK (length(signed_report) BETWEEN 1 AND 131072),
      PRIMARY KEY (allocation_id, sequence), UNIQUE (allocation_id, checkpoint)
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_pending_report (
      allocation_id TEXT PRIMARY KEY, sequence BIGINT NOT NULL,
      FOREIGN KEY (allocation_id, sequence) REFERENCES meter_local_reports(allocation_id, sequence)
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_report_receipts (
      allocation_id TEXT NOT NULL, sequence BIGINT NOT NULL, checkpoint TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'quarantined')), response_json TEXT NOT NULL,
      revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
      PRIMARY KEY (allocation_id, sequence),
      FOREIGN KEY (allocation_id, sequence) REFERENCES meter_local_reports(allocation_id, sequence)
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_close_requests (
      allocation_id TEXT PRIMARY KEY REFERENCES meter_capacity_history(id),
      revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991), checkpoint TEXT NOT NULL
    )`,
    ...immutableMeterRows(
      dialect,
      'meter_local_reports',
      'allocation_id = NEW.allocation_id AND (sequence = NEW.sequence OR checkpoint = NEW.checkpoint)',
    ),
    ...immutableMeterRows(
      dialect,
      'meter_report_receipts',
      'allocation_id = NEW.allocation_id AND sequence = NEW.sequence',
    ),
    ...immutableMeterRows(dialect, 'meter_close_requests', 'allocation_id = NEW.allocation_id'),
  ];
}
