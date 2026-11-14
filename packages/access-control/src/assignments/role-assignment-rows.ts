import {
  recordedDecoder,
  type ChildRowsProjection,
  type ProjectedMessage,
  type ProjectedRows,
} from '@on.auto/operations';
import { Option } from 'effect';

import {
  RoleAssignmentEventSchema,
  principalKeyOf,
  roleAssignmentsKind,
  type RecordedRoleAssignmentEvent,
} from './role-assignment-facts.ts';

export const roleAssignmentsName = 'role_assignments';

const roleAssignmentFactOf = recordedDecoder(RoleAssignmentEventSchema);

interface Referenced {
  readonly type: string;
  readonly id: string;
}

export function assignmentKeyOf({ scope, role }: { readonly scope: Referenced; readonly role: Referenced }): string {
  return `${scope.type}/${scope.id}/${role.type}/${role.id}`;
}

function rowsWithout(rows: ProjectedRows, child: string): ProjectedRows | undefined {
  if (!rows.has(child)) {
    return undefined;
  }
  const kept = new Map(rows);
  kept.delete(child);
  return kept;
}

function rowsAfterFact(
  rows: ProjectedRows,
  { type, data, context }: RecordedRoleAssignmentEvent,
): ProjectedRows | undefined {
  const child = assignmentKeyOf(data);
  if (type === 'role_unassigned') {
    return rowsWithout(rows, child);
  }
  return new Map([
    ...rows,
    [
      child,
      {
        principal_type: data.principal.type,
        principal_id: data.principal.id,
        role_type: data.role.type,
        role_id: data.role.id,
        scope_type: data.scope.type,
        scope_id: data.scope.id,
        source: data.source,
        assigned_at: context.at,
        assigned_by: context.by,
      },
    ],
  ]);
}

export const roleAssignmentRows: ChildRowsProjection = {
  name: roleAssignmentsName,
  version: 1,
  scopes: ['org'],
  kinds: [roleAssignmentsKind],
  types: ['role_assigned', 'role_unassigned'],
  columns: [
    { name: 'principal_type', kind: 'text' },
    { name: 'principal_id', kind: 'text' },
    { name: 'role_type', kind: 'text' },
    { name: 'role_id', kind: 'text' },
    { name: 'scope_type', kind: 'text' },
    { name: 'scope_id', kind: 'text' },
    { name: 'source', kind: 'text' },
    { name: 'assigned_at', kind: 'text' },
    { name: 'assigned_by', kind: 'text' },
  ],
  indexes: [],
  keyOf: (message: ProjectedMessage) =>
    Option.getOrUndefined(Option.map(roleAssignmentFactOf(message), ({ data }) => principalKeyOf(data.principal))),
  rowsAfter: (rows, message) =>
    Option.getOrUndefined(Option.flatMapNullishOr(roleAssignmentFactOf(message), (fact) => rowsAfterFact(rows, fact))),
};
