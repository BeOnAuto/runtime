import { Conflict, type StartingTrigger, type Unavailable } from '@on.auto/operations';
import { Context, Effect, Option } from 'effect';

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

export interface Meter {
  readonly admit: (run: MeteredRun) => Effect.Effect<void, Conflict | Unavailable>;
}

export class RunMeter extends Context.Service<RunMeter, Meter>()('@on.auto/definitions/RunMeter') {}

const unmetered = new Conflict({
  detail: 'This runtime was composed without its meter, so it starts no run; reinstall it as it is released',
  kind: 'metering_fault',
});

export const admittedByTheMeter = Effect.fnUntraced(function* (run: MeteredRun) {
  const meter = yield* Effect.serviceOption(RunMeter);
  return yield* Option.isNone(meter) ? unmetered : meter.value.admit(run);
});
