import { callMarginMs, defineSendRunEvent, makeWorkflowAdapter, type ExpressionCheck } from '@on.auto/coordination';
import {
  operationsInTheDirectoryListing,
  operationsOfCapabilities,
  type PlaybookOwnNames,
  type Capability,
  type CapabilityFacts,
  type CapabilityOperations,
} from '@on.auto/definitions';
import { makeCatalog, makeDispatcher, type RouteRegistration } from '@on.auto/operations';

import {
  directoryOperationsServing,
  playbookOperationsServing,
  type ServedConnectionAccess,
  type ServedConnectionEvents,
  type ServedGoals,
  type ServedPages,
} from '../composition/playbook-operations.ts';
import { accessControlServing } from '../composition/served-access-control.ts';
import { routesFor, type ServedCatalog } from '../composition/served-routes.ts';
import type { Served } from '../server-options/server-options.ts';
import { connectionIntakeServedBy } from './connection-intake.ts';
import { openedHost, type HostParts, type HostRuntime } from './host-dependencies.ts';
import { hostDispatchesOf, hostOnceOpened, hostOperationsOf } from './host-operations.ts';

interface OrgOperation {
  readonly registration: RouteRegistration<'org'>;
}

interface PlaybookOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export interface WorkflowParts
  extends HostParts, ServedPages, ServedGoals, ServedConnectionAccess, ServedConnectionEvents {
  readonly playbooksOver: (capabilities: readonly Capability[]) => {
    readonly playbooks: readonly OrgOperation[];
    readonly imports: readonly OrgOperation[];
  };
  readonly orgOperations: readonly OrgOperation[];
  readonly playbookOperations: readonly PlaybookOperation[];
  readonly capabilityOperations: readonly CapabilityOperations<PlaybookOperation | OrgOperation>[];
  readonly check: ExpressionCheck;
  readonly facts: CapabilityFacts;
  readonly names: PlaybookOwnNames;
  readonly authorizationServer: ServedCatalog['authorizationServer'];
  readonly retryStateKeys: ServedCatalog['retryStateKeys'];
  readonly contentAddressKey: ServedCatalog['contentAddressKey'];
  readonly answerStores?: ServedCatalog['answerStores'];
  readonly eventStores?: Omit<NonNullable<ServedCatalog['eventStores']>, 'takeIn'> | undefined;
  readonly shippedFiles: ServedCatalog['shippedFiles'];
}

function eventsTakenInBy(runtime: HostRuntime, parts: WorkflowParts): ServedCatalog['eventStores'] {
  const { eventStores, store, evaluations, clock } = parts;
  const now = clock?.now ?? Date.now;
  return eventStores === undefined
    ? undefined
    : {
        ...eventStores,
        takeIn: connectionIntakeServedBy(runtime, {
          store,
          filters: evaluations.filters,
          providers: eventStores.providers,
          now,
        }),
      };
}

function isOrgOperation(operation: PlaybookOperation | OrgOperation): operation is OrgOperation {
  return operation.registration.scope === 'org';
}

export function longestCallOf(capabilities: readonly Pick<Capability, 'longestAnyRunMs'>[]): number {
  return Math.max(0, ...capabilities.map(({ longestAnyRunMs }) => longestAnyRunMs)) + callMarginMs;
}

function catalogsOf(
  parts: WorkflowParts,
  capabilities: readonly Capability[],
  sendRunEvent: ReturnType<typeof defineSendRunEvent>,
) {
  const { playbooks, imports } = parts.playbooksOver(capabilities);
  const catalogOf = (
    definitionOperations: ReturnType<typeof playbookOperationsServing>,
    capabilityOperations: readonly (PlaybookOperation | OrgOperation)[],
  ) =>
    makeCatalog([
      ...playbooks,
      ...parts.orgOperations,
      ...imports,
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
  const { runs, opened } = hostOnceOpened();
  const { names, shippedFiles } = parts;
  const workflow = makeWorkflowAdapter({
    runs,
    check: parts.check,
    connectionEvents: parts.connectionEvents,
    mostDurationMs: parts.workflows.mostDurationMs,
    longestCallMs: longestCallOf(parts.capabilities),
    names,
    goals: parts.goals,
  });
  const capabilities = [...parts.capabilities, workflow];
  const hostOperations = hostOperationsOf(capabilities);
  const { catalog, directoryCatalog } = catalogsOf(parts, capabilities, defineSendRunEvent(runs, names));
  const dispatched = { catalogs: [catalog, directoryCatalog], host: hostOperations };
  const { decisionPoint, callContext } = await accessControlServing(runtime, dispatched, shippedFiles);
  const dispatcher = makeDispatcher([], { decidedBy: decisionPoint });
  const host = await openedHost(
    runtime,
    hostDispatchesOf(dispatcher, hostOperations),
    { ...parts, capabilities },
    { names },
  );
  opened(host);
  const { authorizationServer, retryStateKeys, contentAddressKey, answerStores } = parts;
  const served = {
    catalog,
    directoryCatalog,
    dispatcher,
    capabilities,
    pages: true,
    goals: parts.goals,
    messages: parts.messages,
    authorizationServer,
    retryStateKeys,
    contentAddressKey,
    answerStores,
    eventStores: eventsTakenInBy(runtime, parts),
    shippedFiles,
  };
  return { routes: await routesFor(runtime, served), stopWork: host.stop, callContext };
}
