import { recordedRunIn, type RecordedRun } from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { offlineCheckpoint } from '@on.auto/metering';
import { Effect, Schema } from 'effect';

import type { OfflineReservation } from '../offline-reservations/records.ts';
import { inputDigest, playbookAddress, runtimeQuoteVersion } from './binding.ts';
import type { ReconciledRuns, ReconcileRunsRequest, RuntimeRunOptions } from './records.ts';

const rowsOf = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })));
const versionOf = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.Literal(runtimeQuoteVersion),
    Schema.Literals(['computation', 'recall']),
    Schema.String,
    Schema.Int,
    Schema.String,
  ]),
);
const mostAtOnce = 100;

async function verifyEnding(reservation: OfflineReservation, recorded: RecordedRun): Promise<void> {
  const [, type, name, version] = versionOf(JSON.parse(reservation.context.definitionVersion));
  const { run } = recorded;
  if (
    run.type !== type ||
    run.name !== name ||
    run.definition_version !== version ||
    (await inputDigest(recorded.input)) !== reservation.context.inputDigest
  )
    throw new Error('runtime_ending_mismatch');
}

async function releaseEnded(
  options: RuntimeRunOptions,
  reservation: OfflineReservation,
  recorded: RecordedRun,
): Promise<'settled'> {
  await verifyEnding(reservation, recorded);
  const evidenceDigest = await offlineCheckpoint(
    JSON.stringify(['auto.runtime.finished.v1', reservation.id, recorded.run]),
  );
  await options.meter.accounting.release({
    reservationId: reservation.id,
    reason: reservation.state === 'held' ? 'not-dispatched' : 'completed',
    evidenceDigest,
  });
  return 'settled';
}

async function settleRun(
  options: RuntimeRunOptions,
  request: ReconcileRunsRequest,
  id: string,
): Promise<'settled' | 'pending'> {
  const reservation = await options.meter.accounting.reservation(id);
  if (reservation === undefined) throw new Error('runtime_reservation_missing');
  if (reservation.state === 'settled') return 'settled';
  const playbook = playbookAddress(reservation.context.run.playbookId);
  if (playbook === undefined) return 'pending';
  const recorded = await Effect.runPromise(
    recordedRunIn(request.reader, { ...playbook, id: reservation.context.run.runId }),
  );
  if (recorded === undefined || recorded.run.status === 'started') return 'pending';
  return releaseEnded(options, reservation, recorded);
}

async function reconcileOne(options: RuntimeRunOptions, request: ReconcileRunsRequest, id: string) {
  try {
    return await settleRun(options, request, id);
  } catch {
    return 'failed';
  }
}

export async function reconcileRuns(
  options: RuntimeRunOptions,
  request: ReconcileRunsRequest,
): Promise<ReconciledRuns> {
  const rows = rowsOf(
    await options.connection.read(statement`SELECT s.id FROM meter_reservation_state s
    JOIN meter_reservations r ON r.id = s.id WHERE s.state <> 'settled' AND s.id > ${request.afterId ?? ''}
    AND r.maximum_units = 1000000 AND r.capabilities_json IN ('["computation"]', '["recall"]')
    ORDER BY s.id LIMIT ${mostAtOnce}`),
  );
  const results = await Effect.runPromise(
    Effect.forEach(rows, ({ id }) => Effect.promise(() => reconcileOne(options, request, id)), { concurrency: 4 }),
  );
  return {
    inspected: rows.length,
    settled: results.filter((result) => result === 'settled').length,
    pending: results.filter((result) => result === 'pending').length,
    failed: results.filter((result) => result === 'failed').length,
    afterId: rows.length === mostAtOnce ? rows.at(-1)?.id : undefined,
  };
}
