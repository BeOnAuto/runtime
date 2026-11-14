import type { AppRuntime } from '@on.auto/api';
import {
  openWorkflowHost,
  type DueWork,
  type FollowerConsumers,
  type HostClock,
  type HostOptions,
  type ProjectorSettings,
  type StartFunction,
  type WorkflowHost,
  type WorkflowStore,
} from '@on.auto/workflow-host';

import { logWorkflows } from '../logging/logging.ts';
import type { ServerServices } from '../server-options/composed-options.ts';
import type { Settings } from '../settings/settings.ts';
import type { HostDispatches } from './host-operations.ts';
import { hostReports } from './host-reports.ts';
import { hostWorkOf, type WorkParts } from './host-work.ts';
import { orphansSweptIn } from './orphan-sweep.ts';
import { functionStartOf, startingWorkWhere } from './reaction-dependencies.ts';

export interface StudioAddress {
  readonly studio: Settings['studio'];
  readonly runtime: () => string;
}

export interface StartingParts {
  readonly start: StartFunction;
  readonly studioAddress: StudioAddress;
  readonly runtime: HostRuntime;
  readonly now: () => number;
}

export interface StartedWork {
  readonly dueWork: readonly DueWork[];
  readonly consumers: FollowerConsumers;
}

export type StartingWork = (parts: StartingParts) => Promise<StartedWork>;

const nothingStarted: StartedWork = { dueWork: [], consumers: [] };

export interface ConsumingParts {
  readonly runtime: HostRuntime;
  readonly store: WorkflowStore;
  readonly evaluations: WorkParts['evaluations'];
}

type ConsumersOf = (parts: ConsumingParts) => FollowerConsumers;

export interface HostParts {
  readonly ledger: Settings['ledger'];
  readonly workflows: Settings['workflows'];
  readonly capabilities: WorkParts['capabilities'];
  readonly store: WorkflowStore;
  readonly projector: ProjectorSettings;
  readonly dueWork: NonNullable<HostOptions['dueWork']>;
  readonly evaluations: WorkParts['evaluations'];
  readonly clock?: HostClock;
  readonly startingWork?: StartingWork;
  readonly studioAddress: StudioAddress;
  readonly results: boolean;
  readonly messages: boolean;
  readonly consumers: FollowerConsumers;
  readonly consumersOf?: ConsumersOf;
}

export type HostRuntime = AppRuntime<ServerServices>;

export async function openedHost(
  runtime: HostRuntime,
  dispatches: HostDispatches,
  {
    workflows,
    capabilities,
    store,
    projector,
    dueWork,
    evaluations,
    clock,
    results,
    messages,
    startingWork,
    studioAddress,
    consumers,
    consumersOf,
  }: HostParts,
  { names }: Pick<WorkParts, 'names'>,
): Promise<WorkflowHost> {
  const start = functionStartOf(runtime, dispatches.startVersion);
  const starting = { start, runtime, now: clock?.now ?? Date.now, studioAddress };
  const started = (await startingWorkWhere(results && messages, startingWork)?.(starting)) ?? nothingStarted;
  const host = await openWorkflowHost({
    database: store,
    projector,
    dueWork: [...dueWork, ...started.dueWork, await orphansSweptIn(runtime)],
    ...hostWorkOf(runtime, dispatches, { capabilities, evaluations, names }),
    reports: hostReports(runtime),
    context: runtime.context,
    sweepEveryMs: workflows.sweepEveryMs,
    mostCallsAtOnce: workflows.mostCallsAtOnce,
    mostOpenCalls: workflows.mostOpenCalls,
    ...(clock === undefined ? {} : { clock }),
    consumers: [
      ...consumers,
      ...(consumersOf === undefined ? [] : consumersOf({ runtime, store, evaluations })),
      ...started.consumers,
    ],
  });
  await runtime.run(logWorkflows(workflows));
  return host;
}
