import type { Conflict, PlaybookAddress, StartingTrigger, Unavailable } from '@on.auto/operations';
import { Context, Effect, Option } from 'effect';

import type { ModelCallCost, RunState } from '../runs/run-state.ts';
import type { RunRejection } from '../runs/run.ts';

export type { ModelCallCost } from '../runs/run-state.ts';

export interface MeteredRun {
  readonly org: string;
  readonly playbook: string;
  readonly run_id: string;
  readonly definition_type: string;
  readonly definition_name: string;
  readonly definition_version: number;
  readonly correlation_id: string;
  readonly called_by: string | null;
  readonly trigger: StartingTrigger | null;
  readonly started_by: string;
}

export interface MeteredEnding {
  readonly org: string;
  readonly playbook: string;
  readonly run_id: string;
  readonly status: 'succeeded' | 'rejected' | 'failed';
  readonly rejection?: RunRejection['reason'];
  readonly model_calls: readonly ModelCallCost[];
}

export interface Meter {
  readonly admit: (run: MeteredRun) => Effect.Effect<void, Conflict | Unavailable>;
  readonly settle: (ending: MeteredEnding) => Effect.Effect<void>;
}

export class RunMeter extends Context.Service<RunMeter, Meter>()('@on.auto/definitions/RunMeter') {}

export const admittedByTheMeter = Effect.fnUntraced(function* (run: MeteredRun) {
  const meter = yield* Effect.serviceOption(RunMeter);
  if (Option.isSome(meter)) {
    yield* meter.value.admit(run);
  }
});

function endingOf({ org, playbook }: PlaybookAddress, runId: string, state: RunState): MeteredEnding | undefined {
  if (state?.result === undefined || state.run.status === 'started') {
    return undefined;
  }
  const rejection = state.run.rejection?.reason;
  return {
    org,
    playbook,
    run_id: runId,
    status: state.run.status,
    ...(rejection === undefined ? {} : { rejection }),
    model_calls: state.costs,
  };
}

export const settledWithTheMeter = Effect.fnUntraced(function* (
  address: PlaybookAddress,
  runId: string,
  state: RunState,
) {
  const ending = endingOf(address, runId, state);
  const meter = yield* Effect.serviceOption(RunMeter);
  if (ending !== undefined && Option.isSome(meter)) {
    yield* meter.value.settle(ending);
  }
});
