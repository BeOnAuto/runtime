import { cedarDecisionPoint, cedarModuleIn, editorRoleForEveryPerson } from '@on.auto/access-control';
import type { Catalog, PolicyDecisionPoint, RouteRegistration } from '@on.auto/operations';
import type { ShippedFiles } from '@on.auto/shipped-files';

import { hostRegistrationsOf, type HostOperations } from '../workflows/host-operations.ts';

interface Dispatched {
  readonly catalogs: readonly Catalog[];
  readonly host: HostOperations;
}

function operationsDispatched({ catalogs, host }: Dispatched): readonly RouteRegistration[] {
  return [...catalogs.flatMap(({ operations }) => operations), ...hostRegistrationsOf(host)];
}

export function decisionPointServing(dispatched: Dispatched, shippedFiles: ShippedFiles): PolicyDecisionPoint {
  return cedarDecisionPoint({
    module: cedarModuleIn(shippedFiles),
    files: shippedFiles,
    operations: operationsDispatched(dispatched),
    roles: editorRoleForEveryPerson,
  });
}
