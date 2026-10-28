import type { Meter, MeteredRun } from '@on.auto/definitions';
import type { LogPorts } from '@on.auto/ledger';
import type { Conflict, Ledger, Unavailable } from '@on.auto/operations';
import { Effect, Ref } from 'effect';

import type { Counting } from '../counting/run-starts.ts';
import type { Fault, MeterState } from '../meter-stream/meter-events.ts';
import {
  counted,
  faultRefusal,
  hasStarted,
  meterStateOf,
  meterUnavailable,
  startedVerified,
  type MeterOptions,
  type Metering,
} from './metering.ts';

export type Admitter = (run: MeteredRun, counting: Counting) => Effect.Effect<void, Conflict | Unavailable>;

export type FaultRepair = (fault: Fault) => Effect.Effect<void>;

const repairsNothing: FaultRepair = () => Effect.void;

export interface MeteredLedger {
  readonly ledger: Ledger['Service'];
  readonly log: LogPorts;
}

function standingAfter(metering: Metering, repaired: FaultRepair): Effect.Effect<MeterState> {
  return Effect.flatMap(meterStateOf(metering), (state) =>
    state.fault === undefined ? Effect.succeed(state) : Effect.andThen(repaired(state.fault), meterStateOf(metering)),
  );
}

export function meterAdmitting(metering: Metering, admitter: Admitter, repaired: FaultRepair = repairsNothing): Meter {
  return {
    admit: (run) =>
      Effect.gen(function* () {
        const state = yield* standingAfter(metering, repaired);
        if (state.fault !== undefined) return yield* faultRefusal(state.fault, metering.options);
        const counting = yield* counted(metering, state);
        if (yield* hasStarted(metering, run)) return yield* Effect.void;
        return yield* admitter(run, counting);
      }).pipe(Effect.catchDefect(() => Effect.fail(meterUnavailable))),
  };
}

export function meteringOver({ ledger, log }: MeteredLedger, options: MeterOptions): Effect.Effect<Metering> {
  return Effect.gen(function* () {
    const admissions = yield* Ref.make(0);
    const metering: Metering = {
      ledger,
      log,
      options,
      admissionNumbered: Ref.updateAndGet(admissions, (count) => count + 1),
    };
    yield* startedVerified(metering);
    return metering;
  });
}
