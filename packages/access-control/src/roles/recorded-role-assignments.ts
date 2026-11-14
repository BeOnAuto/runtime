import type { PrincipalReference, ProjectedKeyedRow, ProjectionReader } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { principalKeyOf } from '../assignments/role-assignment-facts.ts';
import { assignmentKeyOf, roleAssignmentsName } from '../assignments/role-assignment-rows.ts';
import { editorRoleForEveryPerson, type RoleAssignment, type RoleAssignments } from './role-assignments.ts';

export const assignmentsReadAtOnce = 100;

const HeldRowSchema = Schema.Struct({
  role_type: Schema.Literal('built_in'),
  role_id: Schema.String,
  scope_type: Schema.Literals(['org', 'playbook']),
  scope_id: Schema.String,
});

const heldRowOf = Schema.decodeUnknownSync(HeldRowSchema);

type RowsReader = Pick<ProjectionReader, 'readProjectedRows'>;

function assignmentOf({ row }: ProjectedKeyedRow): RoleAssignment {
  const held = heldRowOf(row);
  return { role: { type: held.role_type, id: held.role_id }, scope: { type: held.scope_type, id: held.scope_id } };
}

function heldFrom(
  reader: RowsReader,
  key: string,
  org: string,
  after?: readonly string[],
): Effect.Effect<readonly RoleAssignment[]> {
  return reader
    .readProjectedRows(
      roleAssignmentsName,
      { org },
      {
        where: [{ column: 'row_key', equals: key }],
        orderBy: [],
        order: 'asc',
        ...(after === undefined ? {} : { after }),
        limit: assignmentsReadAtOnce,
      },
    )
    .pipe(
      Effect.flatMap((rows) => {
        const held = rows.map((row) => assignmentOf(row));
        const last = held[assignmentsReadAtOnce - 1];
        return last === undefined
          ? Effect.succeed(held)
          : Effect.map(heldFrom(reader, key, org, [key, assignmentKeyOf(last)]), (more) => [...held, ...more]);
      }),
    );
}

export function roleAssignmentsRecordedIn(reader: RowsReader): RoleAssignments {
  return {
    heldBy: (principal: PrincipalReference, org) => heldFrom(reader, principalKeyOf(principal), org),
  };
}

const roleSources = ['every_person_an_editor', 'role_assignments'] as const;

export type RoleSource = (typeof roleSources)[number];

export function roleAssignmentsFrom(source: RoleSource, reader: RowsReader): RoleAssignments {
  return source === 'role_assignments' ? roleAssignmentsRecordedIn(reader) : editorRoleForEveryPerson;
}
