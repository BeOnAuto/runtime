import type { PrincipalReference } from '@on.auto/operations';
import { Effect } from 'effect';

export interface RoleReference {
  readonly type: 'built_in';
  readonly id: string;
}

export interface ScopeReference {
  readonly type: 'org' | 'playbook' | 'definition';
  readonly id: string;
}

export interface RoleAssignment {
  readonly role: RoleReference;
  readonly scope: ScopeReference;
}

export interface RoleAssignments {
  readonly heldBy: (principal: PrincipalReference, org: string) => Effect.Effect<readonly RoleAssignment[]>;
}

export const editorRoleForEveryPerson: RoleAssignments = {
  heldBy: (principal, org) =>
    Effect.succeed(
      principal.type === 'person'
        ? [{ role: { type: 'built_in', id: 'editor' }, scope: { type: 'org', id: org } }]
        : [],
    ),
};
