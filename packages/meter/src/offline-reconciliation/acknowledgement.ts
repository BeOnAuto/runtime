import { statement } from '@on.auto/ledger';

import type { CapacitySnapshot } from '../offline-capacity/records.ts';
import { readCapacitySnapshot } from '../offline-capacity/snapshot.ts';
import type { OfflineReportDelivery, OfflineReporterOptions, StoredOfflineReport } from '../offline-reports/records.ts';
import { reportAnswer, type ReportAnswer } from './answers.ts';
import { allocationForReport, existingReportReceipt } from './reading.ts';
import { writeReportAcknowledgement } from './writing.ts';

interface Acknowledgement {
  readonly options: OfflineReporterOptions;
  readonly prepared: StoredOfflineReport;
  readonly answer: ReportAnswer;
}

function assertFinalCounters(before: CapacitySnapshot, prepared: StoredOfflineReport, active: boolean): void {
  if (
    before.state !== 'closing' ||
    active ||
    before.counters.some(
      (counter) =>
        counter.reservedUnits !== 0n ||
        counter.committedUnits !==
          prepared.report.counters.find((part) => part.lotId === counter.lotId)?.committedUnits,
    )
  )
    throw new Error('offline_report_close_unresolved');
}

function acknowledgementSnapshot(operation: Acknowledgement): Promise<CapacitySnapshot> {
  return operation.options.connection.readConsistently(async (read) => {
    const before = await readCapacitySnapshot(read);
    if (before === undefined || before.allocation.id !== operation.prepared.allocationId)
      throw new Error('offline_allocation_not_current');
    if (before.state === 'closed') throw new Error('offline_allocation_unavailable');
    if (operation.answer.state === 'closed') {
      const active =
        await read(statement`SELECT r.id FROM meter_reservations r JOIN meter_reservation_state s ON s.id = r.id
        WHERE r.allocation_id = ${before.allocation.id} AND s.state <> 'settled' LIMIT 1`);
      assertFinalCounters(before, operation.prepared, active.length > 0);
    }
    return before;
  });
}

async function acknowledge(operation: Acknowledgement, attempts: number): Promise<OfflineReportDelivery> {
  if (attempts === 0) throw new Error('offline_report_contended');
  const { options, prepared, answer } = operation;
  const existing = () => existingReportReceipt(options.connection, prepared, answer);
  const previous = await existing();
  if (previous !== undefined) return previous;
  try {
    const before = await acknowledgementSnapshot(operation);
    if (await writeReportAcknowledgement(options.connection, before, prepared, answer))
      return {
        allocationId: prepared.allocationId,
        sequence: prepared.sequence,
        checkpoint: prepared.checkpoint,
        state: answer.state,
        status: 'acknowledged',
      };
  } catch (error) {
    const recovered = await existing();
    if (recovered !== undefined) return recovered;
    throw error;
  }
  return acknowledge(operation, attempts - 1);
}

export async function acknowledgeOfflineReport(
  options: OfflineReporterOptions,
  prepared: StoredOfflineReport,
  value: unknown,
): Promise<OfflineReportDelivery> {
  const allocation = await allocationForReport(options.connection, prepared.allocationId);
  return acknowledge({ options, prepared, answer: reportAnswer(value, prepared, allocation) }, 128);
}
