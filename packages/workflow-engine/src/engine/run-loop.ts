import { retriedOnVersionConflict } from '@on.auto/ledger';
import type { Conflict } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { cachedLoadOf, runCacheOf, unreported, type ReportReloaded, type RunCache } from '../cache/run-cache.ts';
import { keptAfter, resolvedIn } from '../cache/run-contents.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import { appendedDecision, type Attempt, type RunDecision } from './decided-append.ts';
import type { RunStores } from './engine-ports.ts';

type RunLoop<Unavailable> = (runId: string, input: RunInput) => Effect.Effect<RunDecision, Conflict | Unavailable>;

export interface RunLoopUpkeep {
  readonly reserve: Effect.Effect<void>;
  readonly report: ReportReloaded;
}

const unattended: RunLoopUpkeep = { reserve: Effect.void, report: unreported };

export function runLoopOf<Unavailable>(
  stores: RunStores<Unavailable>,
  decider: RunDecider,
  cache: RunCache = runCacheOf(),
  { reserve, report }: RunLoopUpkeep = unattended,
): RunLoop<Unavailable> {
  const load = cachedLoadOf({ runStore: stores.runStore, cache, report });
  const dropped = (runId: string) =>
    Effect.sync(() => {
      cache.drop(runId);
    });
  const attempt = (runId: string, input: RunInput): Attempt<Unavailable> =>
    Effect.gen(function* () {
      const loaded = yield* load(runId);
      const run = yield* Effect.result(resolvedIn(cache, stores.payloads, [runId, loaded, input]));
      const outcome = Result.isFailure(run)
        ? Result.fail(run.failure)
        : yield* Effect.andThen(reserve, appendedDecision(stores, [runId, input], [run.success, decider]));
      if (Result.isFailure(outcome)) {
        yield* dropped(runId);
      }
      return outcome;
    }).pipe(Effect.onError(() => dropped(runId)));
  return (runId, input) =>
    retriedOnVersionConflict(attempt(runId, input)).pipe(
      Effect.flatMap(Effect.fromResult),
      Effect.tap((decision) =>
        Effect.sync(() => {
          keptAfter(cache, runId, decision);
        }),
      ),
    );
}
