import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import type { Dispatcher } from '@on.auto/operations';
import {
  openWorkflowHost,
  type HostClock,
  type HostOptions,
  type ProjectorSettings,
  type WorkflowHost,
  type WorkflowStore,
} from '@on.auto/workflow-host';

import { orphansSweptIn } from '../database/ledger-database.ts';
import { logWorkflows } from '../logging/logging.ts';
import type { ServerServices } from '../server-options/composed-options.ts';
import type { Settings } from '../settings/settings.ts';
import { hostReports } from './host-reports.ts';
import { hostWorkOf, type WorkParts } from './host-work.ts';

export interface HostParts {
  readonly ledger: Settings['ledger'];
  readonly workflows: Settings['workflows'];
  readonly capabilities: readonly Capability[];
  readonly store: WorkflowStore;
  readonly projector: ProjectorSettings;
  readonly dueWork: NonNullable<HostOptions['dueWork']>;
  readonly evaluations: WorkParts['evaluations'];
  readonly clock?: HostClock;
}

export type HostRuntime = AppRuntime<ServerServices>;

export async function openedHost(
  runtime: HostRuntime,
  dispatcher: Dispatcher,
  { workflows, capabilities, store, projector, dueWork, evaluations, clock }: HostParts,
  { startVersion, names }: Pick<WorkParts, 'startVersion' | 'names'>,
): Promise<WorkflowHost> {
  const host = await openWorkflowHost({
    database: store,
    projector,
    dueWork: [...dueWork, await orphansSweptIn(runtime)],
    ...hostWorkOf(runtime, dispatcher, { capabilities, startVersion, evaluations, names }),
    reports: hostReports(runtime),
    context: runtime.context,
    sweepEveryMs: workflows.sweepEveryMs,
    mostCallsAtOnce: workflows.mostCallsAtOnce,
    mostOpenCalls: workflows.mostOpenCalls,
    ...(clock === undefined ? {} : { clock }),
  });
  await runtime.run(logWorkflows(workflows));
  return host;
}
