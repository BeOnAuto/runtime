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
import { preparedPolicies, type PreparePolicies } from '../engine/prepared-policies.ts';
import { accessControlShippedRoots } from '../files/access-control-files.ts';
import type { RoleAssignment, RoleAssignments } from '../roles/role-assignments.ts';
import type { DeclaredAction } from '../schema/access-schema.ts';

export const filesOnDisk = shippedFilesOnDisk(accessControlShippedRoots());

export const cedarOnDisk = cedarModuleIn(filesOnDisk);

export interface TestOperation extends DeclaredAction {
  readonly kind: OperationKind;
  readonly permissionsManagement: boolean;
  readonly enrolment?: boolean;
  readonly connectionsManagement?: boolean;
}

interface Declared {
  readonly permissions: readonly Permission[];
  readonly targetsPlaybook?: boolean;
  readonly permissionsManagement?: boolean;
  readonly enrolment?: boolean;
  readonly connectionsManagement?: boolean;
}

function declared(scope: TestOperation['scope'], kind: OperationKind, name: string, said: Declared): TestOperation {
  return {
    scope,
    kind,
    name,
    permissions: said.permissions,
    targetsPlaybook: said.targetsPlaybook ?? false,
    permissionsManagement: said.permissionsManagement ?? false,
    ...(said.enrolment === true ? { enrolment: true } : {}),
    ...(said.connectionsManagement === true ? { connectionsManagement: true } : {}),
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

export const runDefinition = declared('playbook', 'command', 'run_definition', {
  permissions: ['playbook:write', 'playbook:run'],
});

export const updateDefinition = declared('playbook', 'command', 'update_definition', {
  permissions: ['playbook:write'],
});

const makeComment = declared('playbook', 'command', 'make_comment', { permissions: ['playbook:read'] });

export const assignARole = declared('org', 'command', 'assign_role', {
  permissions: ['org:write'],
  permissionsManagement: true,
});

export const joinTheOrg = declared('org', 'command', 'join_org', { permissions: ['org:write'], enrolment: true });

export const setConnectionModel = declared('org', 'command', 'set_connection_model', {
  permissions: ['org:write'],
  connectionsManagement: true,
});

export const declaredOperations: readonly TestOperation[] = [
  listConnections,
  listPlaybooks,
  searchInOrg,
  createPlaybook,
  setConnectionPlaybooks,
  getDefinition,
  runDefinition,
  updateDefinition,
  makeComment,
  assignARole,
  joinTheOrg,
  setConnectionModel,
];

export function builtIn(role: string, scope: RoleAssignment['scope']): RoleAssignment {
  return { role: { type: 'built_in', id: role }, scope };
}

export function rolesHeld(byPrincipal: Readonly<Record<string, readonly RoleAssignment[]>>): RoleAssignments {
  return { heldBy: (principal) => Effect.succeed(byPrincipal[principal.id] ?? []) };
}

interface CountingReads {
  readonly roles: RoleAssignments;
  readonly reads: () => number;
}

export function countingReads(roles: RoleAssignments): CountingReads {
  const counted = { reads: 0 };
  return {
    roles: {
      heldBy: (principal, org) =>
        Effect.suspend(() => {
          counted.reads += 1;
          return roles.heldBy(principal, org);
        }),
    },
    reads: () => counted.reads,
  };
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
  readonly permissionsManagement?: boolean;
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
  permissionsManagement = operation.permissionsManagement,
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
        permissionsManagement,
        enrolment: operation.enrolment === true,
        connectionsManagement: operation.connectionsManagement === true,
      },
    },
  };
}

export function decidedBy(
  roles: RoleAssignments,
  operations: readonly DeclaredAction[] = declaredOperations,
  preparing: PreparePolicies = preparedPolicies,
): (request: AccessRequest) => Promise<AccessDecision> {
  const decisionPoint = cedarDecisionPoint({ module: cedarOnDisk, files: filesOnDisk, operations, roles, preparing });
  return (request) => Effect.runPromise(decisionPoint.decide(request));
}
