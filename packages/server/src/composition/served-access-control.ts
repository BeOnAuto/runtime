import {
  CallerRoles,
  cedarDecisionPointLoaded,
  cedarModuleIn,
  roleAssignmentsFrom,
  type DeclaredAction,
  type PreparePolicies,
  type RoleAssignments,
} from '@on.auto/access-control';
import type { AppRuntime, CallContext } from '@on.auto/api';
import {
  CallPermission,
  callPermissionDecidedBy,
  type Catalog,
  type DispatcherServices,
  type PolicyDecisionPoint,
  type RouteRegistration,
} from '@on.auto/operations';
import type { ShippedFiles } from '@on.auto/shipped-files';
import { Context, Data, Effect } from 'effect';

import { hostRegistrationsOf, type HostOperations } from '../workflows/host-operations.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export class UnusableAccessPoliciesError extends Data.TaggedError('UnusableAccessPoliciesError')<{
  readonly message: string;
}> {}

interface Dispatched {
  readonly catalogs: readonly Catalog[];
  readonly host: HostOperations;
}

interface ServedAccessControl {
  readonly decisionPoint: PolicyDecisionPoint;
  readonly callContext: CallContext;
}

function operationsDispatched({ catalogs, host }: Dispatched): readonly RouteRegistration[] {
  return [...catalogs.flatMap(({ operations }) => operations), ...hostRegistrationsOf(host)];
}

export function decisionPointOver(
  operations: readonly DeclaredAction[],
  shippedFiles: ShippedFiles,
  roles: RoleAssignments,
  preparing?: PreparePolicies,
): Effect.Effect<PolicyDecisionPoint, UnusableAccessPoliciesError> {
  const module = cedarModuleIn(shippedFiles);
  const parts = { module, files: shippedFiles, operations, roles, ...(preparing === undefined ? {} : { preparing }) };
  return cedarDecisionPointLoaded(parts).pipe(
    Effect.mapError(
      (because) => new UnusableAccessPoliciesError({ message: `The access policies cannot be used: ${because}` }),
    ),
  );
}

export function decisionPointServing(
  dispatched: Dispatched,
  shippedFiles: ShippedFiles,
  roles: RoleAssignments,
  preparing?: PreparePolicies,
): Effect.Effect<PolicyDecisionPoint, UnusableAccessPoliciesError> {
  return decisionPointOver(operationsDispatched(dispatched), shippedFiles, roles, preparing);
}

function callContextDecidedBy(decisionPoint: PolicyDecisionPoint, roles: RoleAssignments): CallContext {
  const context = Context.add(Context.make(CallPermission, callPermissionDecidedBy(decisionPoint)), CallerRoles, roles);
  return () => context;
}

interface PolicyFiles {
  readonly shippedFiles: ShippedFiles;
  readonly preparingPolicies?: PreparePolicies | undefined;
}

export async function accessControlServing(
  runtime: AppRuntime<DispatcherServices>,
  dispatched: Dispatched,
  { shippedFiles, preparingPolicies: preparing }: PolicyFiles,
): Promise<ServedAccessControl> {
  const roles = roleAssignmentsFrom('role_assignments', runtimeLedger(runtime));
  const decisionPoint = await Effect.runPromise(
    inRuntime(runtime, decisionPointServing(dispatched, shippedFiles, roles, preparing)),
  );
  return { decisionPoint, callContext: callContextDecidedBy(decisionPoint, roles) };
}
