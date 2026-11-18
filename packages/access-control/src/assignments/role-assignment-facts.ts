import {
  ActedContextSchema,
  ContextReference,
  OrgIdSchema,
  PlaybookIdSchema,
  factOf,
  uuidV5,
  type Decided,
} from '@on.auto/operations';
import { Schema } from 'effect';

import { builtInRoleIds, type BuiltInRoleId } from '../roles/built-in-roles.ts';

export const roleAssignmentsKind = 'role-assignments';

const scopesOfRoleAssignments = 'ece75a9e-0c96-4bbd-9172-758cebf0cfe9';

const AssignedPrincipalSchema = Schema.Struct({
  type: Schema.Literal('person'),
  id: ContextReference.check(Schema.isMinLength(1)),
});

export type AssignedPrincipal = typeof AssignedPrincipalSchema.Type;

export const AssignedRoleSchema = Schema.Struct({
  type: Schema.Literal('built_in'),
  id: Schema.Literals(builtInRoleIds),
});

export type AssignedRole = typeof AssignedRoleSchema.Type;

export const roleOfIdentityServiceKey: ReadonlyMap<string, BuiltInRoleId> = new Map([
  ['org:admin', 'admin'],
  ['org:member', 'editor'],
]);

export const identityServiceKeyOfRole: Readonly<Record<BuiltInRoleId, string>> = {
  admin: 'org:admin',
  editor: 'org:member',
  viewer: 'org:member',
};

const AssignmentScopeSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('org'), id: OrgIdSchema }),
  Schema.Struct({ type: Schema.Literal('playbook'), id: PlaybookIdSchema }),
]);

export type AssignmentScope = typeof AssignmentScopeSchema.Type;

export const AssignmentSourceSchema = Schema.Literals([
  'manual',
  'invitation',
  'enrolment',
  'import',
  'command',
  'identity_service',
  'bootstrap',
]);

export type AssignmentSource = typeof AssignmentSourceSchema.Type;

const RoleAssignmentDataSchema = Schema.Struct({
  principal: AssignedPrincipalSchema,
  role: AssignedRoleSchema,
  scope: AssignmentScopeSchema,
  source: AssignmentSourceSchema,
});

export const RoleAssignmentEventSchema = Schema.Union([
  factOf('role_assigned', RoleAssignmentDataSchema, ActedContextSchema),
  factOf('role_unassigned', RoleAssignmentDataSchema, ActedContextSchema),
]);

export type RecordedRoleAssignmentEvent = typeof RoleAssignmentEventSchema.Type;

export type RoleAssignmentEvent = Decided<RecordedRoleAssignmentEvent>;

export function principalKeyOf({ type, id }: { readonly type: string; readonly id: string }): string {
  return `${type}:${id}`;
}

export function roleAssignmentsStreamOf({ type, id }: AssignmentScope): string {
  return `${roleAssignmentsKind}/${uuidV5(scopesOfRoleAssignments, `${type}:${id}`)}`;
}
