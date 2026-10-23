import type { Conflict } from '@on.auto/operations';
import type { ReceivedEvent, RunState } from '@on.auto/workflow-engine';
import type { Effect } from 'effect';

import { systemClock, type HostClock } from '../loop/host-clock.ts';
import { runKeyOf, type RunAddress } from '../runs/run-address.ts';
import { gate, type HostStopped } from './host-gate.ts';
import type { ServingOptions } from './host-serving.ts';
import { standingOn } from './host-standing.ts';
import {
  runRequests,
  type DeliveryAnswer,
  type HostElsewhere,
  type RunStart,
  type StartAnswer,
} from './run-requests.ts';
import { storeOf, type StoreSettings } from './workflow-store.ts';

export interface HostOptions extends Omit<ServingOptions, 'clock'> {
  readonly database: StoreSettings;
  readonly clock?: HostClock;
  readonly holder?: string;
}

type Refusal = Conflict | HostElsewhere | HostStopped;

export interface WorkflowHost {
  readonly start: (run: RunAddress, start: RunStart) => Effect.Effect<StartAnswer, Refusal>;
  readonly deliver: (run: RunAddress, event: ReceivedEvent) => Effect.Effect<DeliveryAnswer, Refusal>;
  readonly stateOf: (run: RunAddress) => Effect.Effect<RunState>;
  readonly stop: () => Promise<void>;
}

export async function openWorkflowHost(options: HostOptions): Promise<WorkflowHost> {
  const clock = options.clock ?? systemClock;
  const store = await storeOf(options.database, options.reports.lostConnection, options.projector?.folders ?? []);
  const standing = await standingOn(store, { ...options, clock }, options.holder);
  const { guarded, closed } = gate();
  const runs = runRequests({ database: store.database, clock, serving: standing.serving });
  const stopped = async (): Promise<void> => {
    await standing.stopReacting();
    await closed();
    await standing.stop();
    await store.database.close();
  };
  const stopping: { done?: Promise<void> } = {};
  return {
    start: (run, start) => guarded(runs.start(run, start)),
    deliver: (run, event) => guarded(runs.deliver(run, event)),
    stateOf: (run) => runs.stateOf(runKeyOf(run)),
    stop: () => {
      stopping.done ??= stopped();
      return stopping.done;
    },
  };
}
