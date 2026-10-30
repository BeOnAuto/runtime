import { Conflict, type Unavailable } from '@on.auto/operations';
import { Effect, Function, Option } from 'effect';

import type { SignedReport } from '../accounts/account-service.ts';
import { executed, meterStateOf, meterUnavailable, nowIso } from '../admission/metering.ts';
import type { Licensing } from '../licensing/licensing.ts';
import { reported } from '../licensing/reports.ts';
import { spentOf, standingAllocation } from './allocation.ts';
import { reportSignatureOf } from './report-signature.ts';

const noKeyToSignWith = new Conflict({
  detail:
    'This runtime holds no license key to sign its report with: give it its key in AUTO_RUNTIME_LICENSE_KEY, or in license.key of its configuration file',
});

const nothingToReport = new Conflict({
  detail: 'This runtime holds no offline credits to report on: an operator of Auto issues them for it',
});

interface Worded {
  readonly detail: string;
}

function allocationReportMade(
  licensing: Licensing,
  key: string,
  of?: string,
): Effect.Effect<SignedReport, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const state = yield* meterStateOf(licensing);
    const allocation = standingAllocation(state);
    if (allocation === undefined) return yield* nothingToReport;
    if (of !== undefined && of !== allocation.id) {
      return yield* new Conflict({ detail: `This runtime holds the offline credits ${allocation.id}, not ${of}` });
    }
    const spent = spentOf(allocation, state);
    const at = yield* nowIso;
    const after = yield* executed(licensing, { type: 'report_allocation', spent, at }).pipe(
      Effect.mapError(() => meterUnavailable),
    );
    const { sequence } = Option.getOrElse(Option.fromNullishOr(after.allocation), Function.constant(allocation));
    const report = { allocation: allocation.id, installation: allocation.installation, sequence, spent, at };
    return { report, signature: reportSignatureOf(key, report) };
  });
}

function allocationReportSent(licensing: Licensing, key: string): Effect.Effect<void> {
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

export function allocationReportOf(
  licensing: Licensing,
  of: string | undefined,
): Effect.Effect<SignedReport, Conflict | Unavailable> {
  return Effect.flatMap(licensing.keyInHand, (key) =>
    key === undefined ? Effect.fail(noKeyToSignWith) : allocationReportMade(licensing, key, of),
  );
}

export function reportedHourly(licensing: Licensing): Effect.Effect<void, Unavailable> {
  return Effect.flatMap(licensing.keyInHand, (key) =>
    key === undefined ? reported(licensing) : Effect.andThen(allocationReportSent(licensing, key), reported(licensing)),
  );
}
