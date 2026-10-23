import type { AppRuntime } from '@on.auto/api';
import { callMarginMs, defineSendRunEvent, makeWorkflowAdapter, type ExpressionCheck } from '@on.auto/coordination';
import { defineStartVersion, type PlaybookOwnNames, type Capability, type CapabilityFacts } from '@on.auto/definitions';
import {
  makeCatalog,
  makeDispatcher,
  type DispatcherServices,
  type RouteRegistration,
  type ShippedFiles,
} from '@on.auto/operations';
import type { WorkflowHost } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { playbookOperationsServing } from '../composition/playbook-operations.ts';
import { routesFor, type ServedCatalog } from '../composition/served-routes.ts';
import type { Served } from '../server-options/server-options.ts';
import { openedHost, type HostParts } from './host-dependencies.ts';

interface OrgOperation {
  readonly registration: RouteRegistration<'org'>;
}

interface PlaybookOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export interface WorkflowParts extends HostParts {
  readonly orgOperations: readonly OrgOperation[];
  readonly playbookOperations: readonly PlaybookOperation[];
  readonly check: ExpressionCheck;
  readonly facts: CapabilityFacts;
  readonly names: PlaybookOwnNames;
  readonly identityIssuer: string;
  readonly retryStateKeys: ServedCatalog['retryStateKeys'];
  readonly shippedFiles: ShippedFiles;
}

export function longestCallOf(capabilities: readonly Pick<Capability, 'longestAnyRunMs'>[]): number {
  return Math.max(0, ...capabilities.map(({ longestAnyRunMs }) => longestAnyRunMs)) + callMarginMs;
}

function onceOpened(opening: Promise<WorkflowHost>): Pick<WorkflowHost, 'start'> {
  return {
    start: (run, start) =>
      Effect.flatMap(
        Effect.promise(() => opening),
        (host) => host.start(run, start),
      ),
  };
}

export async function serveWorkflows(runtime: AppRuntime<DispatcherServices>, parts: WorkflowParts): Promise<Served> {
  const dispatcher = makeDispatcher([]);
  const opening = Promise.withResolvers<WorkflowHost>();
  const { names } = parts;
  const workflow = makeWorkflowAdapter({
    runs: onceOpened(opening.promise),
    check: parts.check,
    mostDurationMs: parts.workflows.mostDurationMs,
    longestCallMs: longestCallOf(parts.capabilities),
    names,
  });
  const capabilities = [...parts.capabilities, workflow];
  const host = await openedHost(
    runtime,
    dispatcher,
    { ...parts, capabilities },
    { startVersion: defineStartVersion(capabilities), names },
  );
  opening.resolve(host);
  const catalog = makeCatalog([
    ...parts.orgOperations,
    ...playbookOperationsServing(capabilities, parts),
    ...parts.playbookOperations,
    defineSendRunEvent(host, names),
  ]);
  const { identityIssuer, retryStateKeys, shippedFiles } = parts;
  const served = { catalog, dispatcher, capabilities, identityIssuer, retryStateKeys, shippedFiles };
  return { routes: await routesFor(runtime, served), stopWork: host.stop };
}
