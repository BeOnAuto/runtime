import type { VersionConflict } from '@on.auto/ledger';
import { checkedContext, recordingOf } from '@on.auto/operations';
import { Data, Effect, Result } from 'effect';

import type { CachedRun } from '../cache/run-cache.ts';
import { RunLogRecordSchema, runLogRecordOf, type InputDecision, type RunDecider } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import { formatWritten } from '../run-log/state-format.ts';
import { requireValuesHeldInline } from '../run-log/written-events.ts';
import type { RunStores } from './engine-ports.ts';
import { recordLineageOf } from './record-lineage.ts';

export interface RunDecision extends InputDecision {
  readonly loaded: CachedRun;
  readonly state: CachedRun['state'];
  readonly version: number;
  readonly format: number;
}

export class SplitDecision extends Data.TaggedError('split_decision')<{
  readonly runId: string;
  readonly events: number;
}> {}

export type Attempt<Unavailable> = Effect.Effect<Result.Result<RunDecision, Unavailable>, VersionConflict>;

const recorded = recordingOf(RunLogRecordSchema);

function nothingAppended(run: CachedRun, { events, payloads }: InputDecision): RunDecision {
  const { state, version } = run;
  return { loaded: run, events, payloads, state, version, format: formatWritten(run.format, false) };
}

export function appendedDecision<Unavailable>(
  stores: RunStores<Unavailable>,
  [runId, input]: readonly [string, RunInput],
  [run, decider]: readonly [CachedRun, RunDecider],
): Attempt<Unavailable> {
  return Effect.gen(function* () {
    const { contents, format } = run;
    const payloadOffloading = stores.payloads.payloadOffloading;
    const decision = decider.decision(input, run.state, { contents, format, payloadOffloading });
    const [event, ...more] = decision.events;
    if (event === undefined) {
      return Result.succeed(nothingAppended(run, decision));
    }
    if (more.length > 0) {
      return yield* Effect.die(new SplitDecision({ runId, events: decision.events.length }));
    }
    const context = yield* Effect.sync(() => checkedContext(decider.context(input, run.state)));
    yield* Effect.sync(() => recorded(runLogRecordOf(event), context));
    const state = decider.evolve(run.state, event);
    yield* Effect.sync(() => {
      requireValuesHeldInline(event, state);
    });
    const payloads = decision.payloads.filter(({ sha256 }) => contents.get(sha256)?.kind !== 'read');
    const kept = yield* Effect.result(payloads.length === 0 ? Effect.void : stores.payloads.keep(runId, payloads));
    if (Result.isFailure(kept)) {
      return Result.fail(kept.failure);
    }
    const lineage = recordLineageOf(input, run.state, event);
    yield* stores.runStore.append(runId, event, { expectedVersion: run.version, context }, lineage);
    return Result.succeed({ ...decision, loaded: run, state, version: run.version + 1, format: event.format });
  });
}
