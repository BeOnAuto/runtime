import { statement, type ConnectionPorts } from '@on.auto/ledger';

import { capacitySnapshot } from '../offline-capacity/snapshot.ts';
import type { OfflineReporter } from '../offline-reports/records.ts';
import { scheduledMaintenance, type MaintenanceResult } from './poll.ts';

export type ReportPollResult = MaintenanceResult<'reported' | 'quarantined'>;

async function hasMoreUsage(connection: ConnectionPorts): Promise<boolean> {
  const rows = await connection.read(statement`SELECT s.id FROM meter_capacity_head h
    JOIN meter_capacity_state s ON s.id = h.current_id WHERE h.id = 1 AND s.state IN ('open', 'closing') AND (
      EXISTS (SELECT 1 FROM meter_pending_report p WHERE p.allocation_id = s.id)
      OR EXISTS (SELECT 1 FROM meter_local_commands m WHERE m.allocation_id = s.id AND m.kind = 'dispatch' AND m.revision > s.reported_revision)
      OR (s.state = 'closing' AND NOT EXISTS (SELECT 1 FROM meter_reservations r JOIN meter_reservation_state u ON u.id = r.id
        WHERE r.allocation_id = s.id AND u.state <> 'settled'))
    ) LIMIT 1`);
  return rows.length > 0;
}

export function reportMaintenance(
  connection: ConnectionPorts,
  reporter: OfflineReporter,
  monotonicTime: () => number,
): () => Promise<ReportPollResult> {
  return scheduledMaintenance<'reported' | 'quarantined'>(async () => {
    const capacity = await capacitySnapshot(connection);
    if (capacity?.state === 'quarantined' && (await reporter.pending()) === undefined)
      return { status: 'quarantined', retryInMilliseconds: 3_600_000 };
    const result = await reporter.send();
    if (result === undefined) return { status: 'idle', retryInMilliseconds: 300_000 };
    if (result.state === 'quarantined') return { status: 'quarantined', retryInMilliseconds: 3_600_000 };
    return { status: 'reported', retryInMilliseconds: (await hasMoreUsage(connection)) ? 1000 : 300_000 };
  }, monotonicTime);
}
