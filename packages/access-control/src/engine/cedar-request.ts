import type { Context, EntityJson } from '@cedar-policy/cedar-wasm/web';
import type { AccessContext, AccessRequest, PrincipalReference, ResourceReference } from '@on.auto/operations';

import type { RoleAssignment, ScopeReference } from '../roles/role-assignments.ts';
import { actionIdOf } from '../schema/access-schema.ts';

interface Uid {
  readonly type: string;
  readonly id: string;
}

interface CedarCall {
  readonly principal: Uid;
  readonly action: Uid;
  readonly resource: Uid;
  readonly context: Context;
  readonly entities: EntityJson[];
}

interface Placed {
  readonly uid: Uid;
  readonly parents: readonly Uid[];
}

const entityTypeOfPrincipal: Readonly<Record<Exclude<PrincipalReference['type'], 'playbook'>, string>> = {
  person: 'Person',
  key: 'Key',
  local_developer: 'LocalDeveloper',
};

export function orgOfResource(resource: ResourceReference): string {
  return resource.type === 'org' ? resource.id : resource.org;
}

function orgUid(org: string): Uid {
  return { type: 'Org', id: org };
}

function playbookUid(org: string, playbook: string): Uid {
  return { type: 'Playbook', id: JSON.stringify([org, playbook]) };
}

function definitionUid(org: string, playbook: string, definition: string): Uid {
  return { type: 'Definition', id: JSON.stringify([org, playbook, definition]) };
}

function resourceUidOf(resource: ResourceReference): Uid {
  if (resource.type === 'org') {
    return orgUid(resource.id);
  }
  return resource.type === 'playbook'
    ? playbookUid(resource.org, resource.id)
    : definitionUid(resource.org, resource.playbook, resource.id);
}

function placesOf(resource: ResourceReference): readonly Placed[] {
  const org: Placed = { uid: orgUid(orgOfResource(resource)), parents: [] };
  if (resource.type === 'org') {
    return [org];
  }
  const playbookId = resource.type === 'playbook' ? resource.id : resource.playbook;
  const playbook: Placed = { uid: playbookUid(resource.org, playbookId), parents: [org.uid] };
  return resource.type === 'playbook'
    ? [org, playbook]
    : [org, playbook, { uid: resourceUidOf(resource), parents: [playbook.uid] }];
}

function scopesHolding(resource: ResourceReference): readonly ScopeReference[] {
  const org: ScopeReference = { type: 'org', id: orgOfResource(resource) };
  if (resource.type === 'org') {
    return [org];
  }
  if (resource.type === 'playbook') {
    return [{ type: 'playbook', id: resource.id }, org];
  }
  return [{ type: 'definition', id: resource.id }, { type: 'playbook', id: resource.playbook }, org];
}

function rolesAt(resource: ResourceReference, assignments: readonly RoleAssignment[]): readonly Uid[] {
  const scopes = scopesHolding(resource);
  const held = assignments
    .filter(({ scope }) => scopes.some(({ type, id }) => type === scope.type && id === scope.id))
    .map(({ role }) => role.id);
  return [...new Set(held)].map((role) => ({ type: 'Role', id: role }));
}

function principalPlaced(principal: PrincipalReference, grantedOrg: string, roles: readonly Uid[]): Placed {
  if (principal.type === 'playbook') {
    return { uid: playbookUid(grantedOrg, principal.id), parents: [orgUid(grantedOrg)] };
  }
  const uid = { type: entityTypeOfPrincipal[principal.type], id: principal.id };
  return { uid, parents: principal.type === 'person' ? roles : [] };
}

function contextOf({ via, granted, operation }: AccessContext): Context {
  const somePlaybooks = granted.playbooks === '*' ? [] : granted.playbooks;
  return {
    via,
    granted: {
      org: { __entity: orgUid(granted.org) },
      permissions: granted.permissions.map((permission) => ({ __entity: { type: 'Action', id: permission } })),
      playbooks: somePlaybooks.map((playbook) => ({ __entity: playbookUid(granted.org, playbook) })),
      all_playbooks: granted.playbooks === '*',
    },
    operation: {
      kind: operation.kind,
      targets_playbook: operation.targetsPlaybook,
      reads_only: operation.readsOnly,
      reaches_outside: operation.reachesOutside,
      may_change_outside: operation.mayChangeOutside,
      irreversible: operation.irreversible,
      permissions_management: operation.permissionsManagement,
      enrolment: operation.enrolment,
      connections_management: operation.connectionsManagement,
    },
  };
}

function entitiesOf(places: readonly Placed[]): EntityJson[] {
  const distinct = new Map(places.map((place) => [JSON.stringify([place.uid.type, place.uid.id]), place]));
  return [...distinct.values()].map(({ uid, parents }) => ({ uid, attrs: {}, parents: [...parents] }));
}

export function cedarCallOf(request: AccessRequest, assignments: readonly RoleAssignment[]): CedarCall {
  const { principal, action, resource, context } = request;
  const acting = principalPlaced(principal, context.granted.org, rolesAt(resource, assignments));
  return {
    principal: acting.uid,
    action: { type: 'Action', id: actionIdOf(action) },
    resource: resourceUidOf(resource),
    context: contextOf(context),
    entities: entitiesOf([...placesOf(resource), acting]),
  };
}
