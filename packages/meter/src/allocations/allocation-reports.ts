import { Conflict, type Unavailable } from '@on.auto/operations';
import { Effect, Function, Option } from 'effect';

import type { SignedReport } from '../accounts/account-service.ts';
import { caughtUp, executed, meterStateOf, meterUnavailable, nowIso, verified } from '../admission/metering.ts';
import { usageFrom, type Licensing } from '../licensing/licensing.ts';
import type { MeterState } from '../meter-stream/meter-events.ts';
import { standingAllocation } from './allocation.ts';
import { reportSignatureOf } from './report-signature.ts';

const nothingToReport = new Conflict({
  detail: 'This runtime holds no allocation to report on: an operator of Auto issues one for its installation',
});

interface Worded {
  readonly detail: string;
}

function actionsToReport(licensing: Licensing, state: MeterState): Effect.Effect<number> {
  const kept = usageFrom(state.checkpoint).actions;
  return state.fault === undefined
    ? Effect.flatMap(caughtUp(licensing, state), (counting) => verified(licensing, counting)).pipe(
        Effect.map(({ actions }) => actions),
        Effect.orElseSucceed(Function.constant(kept)),
      )
    : Effect.succeed(kept);
}

export function allocationReportMade(
  licensing: Licensing,
  key: string,
  of?: string,
): Effect.Effect<SignedReport, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const state = yield* meterStateOf(licensing);
    const allocation = standingAllocation(state);
    if (allocation === undefined) return yield* nothingToReport;
    if (of !== undefined && of !== allocation.id) {
      return yield* new Conflict({ detail: `This runtime holds the allocation ${allocation.id}, not ${of}` });
    }
    const spent = Math.max(0, (yield* actionsToReport(licensing, state)) - allocation.actions);
    const at = yield* nowIso;
    const after = yield* executed(licensing, { type: 'report_allocation', spent, at }).pipe(
      Effect.mapError(() => meterUnavailable),
    );
    const { sequence } = Option.getOrElse(Option.fromNullishOr(after.allocation), Function.constant(allocation));
    const report = { allocation: allocation.id, installation: allocation.installation, sequence, spent, at };
    return { report, signature: reportSignatureOf(key, report) };
  });
}

export function allocationReportSent(licensing: Licensing, key: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (standingAllocation(yield* meterStateOf(licensing)) === undefined) return;
    const signed = yield* allocationReportMade(licensing, key);
    const taken = yield* licensing.account.reportAllocation(key, signed);
    if (taken !== 'taken') {
      yield* Effect.logWarning(
        `Auto did not take the report ${signed.report.sequence} of the allocation ${signed.report.allocation}: ${taken}`,
      );
    }
  }).pipe(
    Effect.catch(({ detail }: Worded) =>
      Effect.logWarning(`This runtime could not report what it spent of its allocation to Auto: ${detail}`),
    ),
  );
}
