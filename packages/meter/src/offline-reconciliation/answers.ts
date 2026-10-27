import { creditUnitsFromWire, type OfflineAllocation } from '@on.auto/metering';
import { Schema } from 'effect';

import type { StoredOfflineReport } from '../offline-reports/records.ts';

const acknowledgement = Schema.decodeUnknownSync(
  Schema.Union([
    Schema.Struct({
      state: Schema.Literals(['open', 'closed']),
      allocationId: Schema.String,
      sequence: Schema.Number,
      checkpoint: Schema.String,
      committedUnits: Schema.String,
      returnedUnits: Schema.String,
    }),
    Schema.Struct({ state: Schema.Literals(['quarantined']), allocationId: Schema.String, reason: Schema.String }),
  ]),
);

export interface ReportAnswer {
  readonly state: 'open' | 'closed' | 'quarantined';
  readonly json: string;
}

export function reportAnswer(
  value: unknown,
  prepared: StoredOfflineReport,
  allocation: OfflineAllocation,
): ReportAnswer {
  const answer = acknowledgement(value);
  if (answer.allocationId !== prepared.allocationId) throw new Error('offline_report_response_mismatch');
  if (answer.state === 'quarantined') {
    if (!/^[a-z0-9_]{1,256}$/u.test(answer.reason)) throw new Error('offline_report_response_invalid');
    return {
      state: answer.state,
      json: JSON.stringify({ state: answer.state, allocationId: answer.allocationId, reason: answer.reason }),
    };
  }
  assertAcknowledged(answer, prepared, allocation);
  return {
    state: answer.state,
    json: JSON.stringify({
      state: answer.state,
      allocationId: answer.allocationId,
      sequence: answer.sequence,
      checkpoint: answer.checkpoint,
      committedUnits: answer.committedUnits,
      returnedUnits: answer.returnedUnits,
    }),
  };
}

function assertAcknowledged(
  answer: Extract<ReturnType<typeof acknowledgement>, { readonly state: 'open' | 'closed' }>,
  prepared: StoredOfflineReport,
  allocation: OfflineAllocation,
): void {
  const committed = prepared.report.counters.reduce((total, counter) => total + counter.committedUnits, 0n);
  const returned = prepared.report.close
    ? allocation.sources.reduce((total, source) => total + source.units, 0n) - committed
    : 0n;
  if (
    answer.sequence !== prepared.sequence ||
    answer.checkpoint !== prepared.checkpoint ||
    answer.state !== (prepared.report.close ? 'closed' : 'open') ||
    creditUnitsFromWire(answer.committedUnits) !== committed ||
    creditUnitsFromWire(answer.returnedUnits) !== returned
  )
    throw new Error('offline_report_response_mismatch');
}
