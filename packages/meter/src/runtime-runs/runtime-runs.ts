import type { RunDispatch } from '@on.auto/definitions';
import { offlineCheckpoint } from '@on.auto/metering';
import { Conflict, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { capturedOptions } from './binding.ts';
import type { RuntimeRunOptions, RuntimeRuns } from './records.ts';
import { admittedReservation } from './reservation.ts';
import { reconcileRuns } from './settlement.ts';

const refusals: Readonly<Record<string, string>> = {
  runtime_quote_unbounded: 'This run needs an approved bound covering all of its work before it can start.',
  runtime_quote_mismatch: 'This run ID already has a different approved definition, input or limits; use a new run ID.',
  license_required: 'Activate this Runtime installation with its license key before running a function.',
  license_not_active: 'This installation license no longer authorizes new work; reconnect it and repair its license.',
  license_clock_untrusted: 'Reconnect this Runtime installation to verify its license time before starting work.',
  offline_allocation_required: 'Allocate credits to this Runtime installation before starting work.',
  'Insufficient eligible credits within the shared balance and daily allowance':
    'This installation does not have enough available credits for the run.',
};

function refused(error: unknown): Conflict | Unavailable {
  const detail = error instanceof Error ? refusals[error.message] : undefined;
  return detail === undefined
    ? new Unavailable({
        detail:
          'The Runtime meter could not authorize this run; inspect the license and credit status before retrying.',
      })
    : new Conflict({ detail });
}

async function dispatch(options: RuntimeRunOptions, run: RunDispatch): Promise<void> {
  const { reservation, capability } = await admittedReservation(options, run);
  const evidenceDigest = await offlineCheckpoint(
    JSON.stringify(['auto.runtime.dispatch.v1', reservation.id, reservation.quoteId]),
  );
  await options.meter.accounting.commitDispatch({
    reservationId: reservation.id,
    run: reservation.context.run,
    capability,
    evidenceDigest,
  });
}

export function selfHostedRuns(options: RuntimeRunOptions): RuntimeRuns {
  const captured = capturedOptions(options);
  return {
    admission: {
      dispatch: (run) => Effect.tryPromise({ try: () => dispatch(captured, structuredClone(run)), catch: refused }),
    },
    reconcile: (request) => reconcileRuns(captured, request),
  };
}
