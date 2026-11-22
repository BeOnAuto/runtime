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

import { attemptsWorkOf } from '../attempt-leases/attempts-work.ts';
import { logWorkflows } from '../logging/logging.ts';
import type { ServerServices } from '../server-options/composed-options.ts';
import type { Settings } from '../settings/settings.ts';
import { hostReports } from './host-reports.ts';
import { hostWorkOf, type WorkParts } from './host-work.ts';
import { orphansSweptIn } from './orphan-sweep.ts';
import { functionStartOf, startingWorkWhere } from './reaction-dependencies.ts';

type HostDispatches = Parameters<typeof hostWorkOf>[1];

type AttemptsWorkParts = Parameters<typeof attemptsWorkOf>[0];

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
  readonly clock?: ServerClock;
  readonly startingWork?: StartingWork;
  readonly studioAddress: StudioAddress;
  readonly results: boolean;
  readonly messages: boolean;
  readonly consumers: FollowerConsumers;
  readonly consumersOf?: ConsumersOf;
  readonly holding: AttemptsWorkParts['holding'];
  readonly access: AttemptsWorkParts['access'];
  readonly wakeUps?: HostOptions['wakeUps'];
}

export type HostRuntime = AppRuntime<ServerServices>;

/**
 * The clock the host sleeps on. A clock a test steps also watches the fibers the host forks, given in the host's
 * context, so that the test knows when the host is wholly at rest.
 */
interface ServerClock extends HostClock {
  readonly watching?: (context: HostContext) => HostContext;
}

type HostContext = NonNullable<HostOptions['context']>;

function hostContextOn(runtime: HostRuntime, clock: ServerClock | undefined): HostContext {
  return clock?.watching?.(runtime.context) ?? runtime.context;
}

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
    holding,
    access,
    wakeUps = [],
  }: HostParts,
  { names }: Pick<WorkParts, 'names'>,
): Promise<WorkflowHost> {
  const start = functionStartOf(runtime, dispatches.startVersion);
  const starting = { start, runtime, now: clock?.now ?? Date.now, studioAddress };
  const started = (await startingWorkWhere(results && messages, startingWork)?.(starting)) ?? nothingStarted;
  const attempts = attemptsWorkOf({ runtime, store, holding, access, dispatches, now: starting.now });
  const work = hostWorkOf(runtime, dispatches, { capabilities, evaluations, names, lookAgain: attempts.lookAgain });
  const ownWork = [await orphansSweptIn(runtime), ...attempts.dueWorkOf(work.waiting.cancel)];
  const host = await openWorkflowHost({
    database: store,
    projector,
    holder: holding.holder,
    dueWork: [...dueWork, ...started.dueWork, ...ownWork],
    ...work,
    reports: hostReports(runtime),
    context: hostContextOn(runtime, clock),
    sweepEveryMs: workflows.sweepEveryMs,
    mostCallsAtOnce: workflows.mostCallsAtOnce,
    mostOpenCalls: workflows.mostOpenCalls,
    ...(clock === undefined ? {} : { clock }),
    wakeUps,
    consumers: [...consumers, ...(consumersOf?.({ runtime, store, evaluations }) ?? []), ...started.consumers],
  });
  await runtime.run(logWorkflows(workflows));
  return host;
}
