import {
  cedarDecisionPoint,
  cedarModuleIn,
  roleAssignmentsFrom,
  type RoleAssignments,
  type RoleSource,
} from '@on.auto/access-control';
import type { Catalog, PolicyDecisionPoint, ProjectionReader, RouteRegistration } from '@on.auto/operations';
import type { ShippedFiles } from '@on.auto/shipped-files';

import { hostRegistrationsOf, type HostOperations } from '../workflows/host-operations.ts';

interface Dispatched {
  readonly catalogs: readonly Catalog[];
  readonly host: HostOperations;
}

function operationsDispatched({ catalogs, host }: Dispatched): readonly RouteRegistration[] {
  return [...catalogs.flatMap(({ operations }) => operations), ...hostRegistrationsOf(host)];
}

export const servedRoleSource: RoleSource = 'every_person_an_editor';

export function rolesServedFrom(ledger: Pick<ProjectionReader, 'readProjectedRows'>): RoleAssignments {
  return roleAssignmentsFrom(servedRoleSource, ledger);
}

export function decisionPointServing(
  dispatched: Dispatched,
  shippedFiles: ShippedFiles,
  roles: RoleAssignments,
): PolicyDecisionPoint {
  return cedarDecisionPoint({
    module: cedarModuleIn(shippedFiles),
    files: shippedFiles,
    operations: operationsDispatched(dispatched),
    roles,
  });
}
