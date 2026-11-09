import { callMarginMs, defineSendRunEvent, makeWorkflowAdapter, type ExpressionCheck } from '@on.auto/coordination';
import {
  defineStartVersion,
  operationsInTheDirectoryListing,
  operationsOfCapabilities,
  type PlaybookOwnNames,
  type Capability,
  type CapabilityFacts,
  type CapabilityOperations,
} from '@on.auto/definitions';
import { makeCatalog, makeDispatcher, type RouteRegistration } from '@on.auto/operations';
import type { ShippedFiles } from '@on.auto/shipped-files';
import type { WorkflowHost } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import {
  directoryOperationsServing,
  playbookOperationsServing,
  type ServedPages,
} from '../composition/playbook-operations.ts';
import { routesFor, type ServedCatalog } from '../composition/served-routes.ts';
import type { Served } from '../server-options/server-options.ts';
import { openedHost, type HostParts, type HostRuntime } from './host-dependencies.ts';

interface OrgOperation {
  readonly registration: RouteRegistration<'org'>;
}

interface PlaybookOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export interface WorkflowParts extends HostParts, ServedPages {
  readonly orgOperations: readonly OrgOperation[];
  readonly playbookOperations: readonly PlaybookOperation[];
  readonly capabilityOperations: readonly CapabilityOperations<PlaybookOperation | OrgOperation>[];
  readonly check: ExpressionCheck;
  readonly facts: CapabilityFacts;
  readonly names: PlaybookOwnNames;
  readonly identityIssuer: string;
  readonly retryStateKeys: ServedCatalog['retryStateKeys'];
  readonly contentAddressKey: ServedCatalog['contentAddressKey'];
  readonly shippedFiles: ShippedFiles;
}

function isOrgOperation(operation: PlaybookOperation | OrgOperation): operation is OrgOperation {
  return operation.registration.scope === 'org';
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

function catalogsOf(
  parts: WorkflowParts,
  capabilities: readonly Capability[],
  sendRunEvent: ReturnType<typeof defineSendRunEvent>,
) {
  const catalogOf = (
    definitionOperations: ReturnType<typeof playbookOperationsServing>,
    capabilityOperations: readonly (PlaybookOperation | OrgOperation)[],
  ) =>
    makeCatalog([
      ...parts.orgOperations,
      ...capabilityOperations.filter((operation) => isOrgOperation(operation)),
      ...definitionOperations,
      ...parts.playbookOperations,
      ...capabilityOperations.filter((operation) => !isOrgOperation(operation)),
      sendRunEvent,
    ]);
  return {
    catalog: catalogOf(
      playbookOperationsServing(capabilities, parts),
      operationsOfCapabilities(parts.capabilityOperations),
    ),
    directoryCatalog: catalogOf(
      directoryOperationsServing(capabilities, parts),
      operationsInTheDirectoryListing(parts.capabilityOperations),
    ),
  };
}

export async function serveWorkflows(runtime: HostRuntime, parts: WorkflowParts): Promise<Served> {
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
  const { catalog, directoryCatalog } = catalogsOf(parts, capabilities, defineSendRunEvent(host, names));
  const { identityIssuer, retryStateKeys, contentAddressKey, shippedFiles } = parts;
  const served = {
    catalog,
    directoryCatalog,
    dispatcher,
    capabilities,
    pages: true,
    identityIssuer,
    retryStateKeys,
    contentAddressKey,
    shippedFiles,
  };
  return { routes: await routesFor(runtime, served), stopWork: host.stop };
}
