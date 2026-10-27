import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { allocationPayload, offlineCheckpoint, type OfflineAllocation } from '@on.auto/metering';
import { Schema } from 'effect';

import type { CapacitySnapshot } from '../offline-capacity/records.ts';
import { readCapacitySnapshot } from '../offline-capacity/snapshot.ts';
import { unreportedCharges } from './charges.ts';
import { readPendingReport, readStoredReport } from './reading.ts';
import type { OfflineReporterOptions, ReportSnapshot, StoredOfflineReport } from './records.ts';

const storedNumber = Schema.Union([Schema.Number, Schema.FiniteFromString]);
const stateRows = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.Struct({
      report_sequence: storedNumber,
      reported_revision: storedNumber,
      server_observation: storedNumber,
    }),
  ]),
);

function assertAuthority(options: OfflineReporterOptions, allocation: OfflineAllocation): void {
  if (
    allocation.issuer !== options.authority.issuer ||
    allocation.ring !== options.authority.ring ||
    allocation.clusterId !== options.installation.clusterId ||
    allocation.installationKeyDigest !== options.installation.installationKeyDigest
  )
    throw new Error('offline_report_authority_mismatch');
}

export function reportSnapshot(
  options: OfflineReporterOptions,
): Promise<ReportSnapshot | StoredOfflineReport | undefined> {
  return options.connection.readConsistently(
    async (read): Promise<ReportSnapshot | StoredOfflineReport | undefined> => {
      const capacity = await readCapacitySnapshot(read);
      if (capacity === undefined) return undefined;
      const allocation = capacity.allocation;
      assertAuthority(options, allocation);
      const pending = await readPendingReport(read, allocation, options.installation);
      if (pending !== undefined) return pending;
      if (capacity.state === 'closed') return undefined;
      if (capacity.state === 'quarantined') throw new Error('offline_allocation_quarantined');
      return progressSnapshot(read, capacity, options);
    },
  );
}

async function assertProgress(
  capacity: CapacitySnapshot,
  reportedRevision: number,
  previous: StoredOfflineReport | undefined,
): Promise<void> {
  const checkpoint =
    previous === undefined ? await offlineCheckpoint(allocationPayload(capacity.allocation)) : previous.checkpoint;
  if (
    checkpoint !== capacity.checkpoint ||
    reportedRevision !== (previous?.chargeRevision ?? 0) ||
    previous?.report.close === true
  )
    throw new Error('offline_report_projection_invalid');
}

async function progressSnapshot(
  read: ConnectionPorts['read'],
  capacity: CapacitySnapshot,
  options: OfflineReporterOptions,
): Promise<ReportSnapshot> {
  const allocation = capacity.allocation;
  const [state] = stateRows(
    await read(statement`SELECT s.report_sequence, s.reported_revision, c.server_observation
      FROM meter_capacity_state s CROSS JOIN meter_clock c WHERE s.id = ${allocation.id} AND c.id = 1`),
  );
  if (state.report_sequence === Number.MAX_SAFE_INTEGER || capacity.revision === Number.MAX_SAFE_INTEGER)
    throw new Error('offline_report_exhausted');
  const previous =
    state.report_sequence === 0
      ? undefined
      : await readStoredReport(read, allocation, options.installation, state.report_sequence);
  await assertProgress(capacity, state.reported_revision, previous);
  const active =
    await read(statement`SELECT r.id FROM meter_reservations r JOIN meter_reservation_state s ON s.id = r.id
      WHERE r.allocation_id = ${allocation.id} AND s.state <> 'settled' LIMIT 1`);
  return {
    capacity,
    sequence: state.report_sequence,
    reportedRevision: state.reported_revision,
    previous,
    charges: await unreportedCharges(read, allocation.id, state.reported_revision),
    activeReservations: active.length > 0,
    observedTime: state.server_observation,
  };
}
