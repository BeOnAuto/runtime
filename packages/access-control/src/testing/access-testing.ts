import {
  allPermissions,
  type AccessDecision,
  type AccessRequest,
  type ArrivedVia,
  type OperationKind,
  type Permission,
  type PlaybookAccess,
  type PrincipalReference,
  type ResourceReference,
} from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Effect } from 'effect';

import { cedarDecisionPoint } from '../decision-point/cedar-decision-point.ts';
import { cedarModuleIn } from '../engine/cedar-module.ts';
import { accessControlShippedRoots } from '../files/access-control-files.ts';
import type { RoleAssignment, RoleAssignments } from '../roles/role-assignments.ts';
import type { DeclaredAction } from '../schema/access-schema.ts';

export const filesOnDisk = shippedFilesOnDisk(accessControlShippedRoots());

export const cedarOnDisk = cedarModuleIn(filesOnDisk);

export interface TestOperation extends DeclaredAction {
  readonly kind: OperationKind;
}

function declared(
  scope: TestOperation['scope'],
  kind: OperationKind,
  name: string,
  permittedBy: { readonly permissions: readonly Permission[]; readonly targetsPlaybook?: boolean },
): TestOperation {
  return {
    scope,
    kind,
    name,
    permissions: permittedBy.permissions,
    targetsPlaybook: permittedBy.targetsPlaybook ?? false,
  };
}

export const listConnections = declared('org', 'query', 'list_connections', { permissions: ['org:read'] });

export const listPlaybooks = declared('org', 'query', 'list_playbooks', { permissions: ['org:read', 'playbook:read'] });

const searchInOrg = declared('org', 'query', 'search_in_org', { permissions: ['org:read'], targetsPlaybook: true });

export const createPlaybook = declared('org', 'command', 'create_playbook', { permissions: ['org:write'] });

const setConnectionPlaybooks = declared('org', 'command', 'set_connection_playbooks', {
  permissions: ['org:write'],
  targetsPlaybook: true,
});

export const getDefinition = declared('playbook', 'query', 'get_definition', { permissions: ['playbook:read'] });

export const runDefinition = declared('playbook', 'command', 'run_definition', { permissions: ['playbook:write'] });

const makeComment = declared('playbook', 'command', 'make_comment', { permissions: ['playbook:read'] });

export const declaredOperations: readonly TestOperation[] = [
  listConnections,
  listPlaybooks,
  searchInOrg,
  createPlaybook,
  setConnectionPlaybooks,
  getDefinition,
  runDefinition,
  makeComment,
];

export function builtIn(role: string, scope: RoleAssignment['scope']): RoleAssignment {
  return { role: { type: 'built_in', id: role }, scope };
}

export function rolesHeld(byPrincipal: Readonly<Record<string, readonly RoleAssignment[]>>): RoleAssignments {
  return { heldBy: (principal) => Effect.succeed(byPrincipal[principal.id] ?? []) };
}

interface Asked {
  readonly principal: PrincipalReference;
  readonly operation: TestOperation;
  readonly resource: ResourceReference;
  readonly via?: ArrivedVia;
  readonly org?: string;
  readonly permissions?: readonly Permission[];
  readonly playbooks?: PlaybookAccess;
  readonly irreversible?: boolean;
}

export function requestOf({
  principal,
  operation,
  resource,
  via = 'studio',
  org = 'acme',
  permissions = allPermissions,
  playbooks = '*',
  irreversible = false,
}: Asked): AccessRequest {
  return {
    principal,
    action: { scope: operation.scope, name: operation.name },
    resource,
    context: {
      via,
      granted: { org, permissions, playbooks },
      operation: {
        kind: operation.kind,
        targetsPlaybook: operation.targetsPlaybook,
        readsOnly: false,
        reachesOutside: false,
        mayChangeOutside: false,
        irreversible,
      },
    },
  };
}

export function decidedBy(
  roles: RoleAssignments,
  operations: readonly DeclaredAction[] = declaredOperations,
): (request: AccessRequest) => Promise<AccessDecision> {
  const decisionPoint = cedarDecisionPoint({ module: cedarOnDisk, files: filesOnDisk, operations, roles });
  return (request) => Effect.runPromise(decisionPoint.decide(request));
}
