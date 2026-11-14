import {
  EventPagingInputFields,
  InvalidInput,
  OrgReader,
  PagingOutputFields,
  cursorOfParts,
  defaultPageLimit,
  defineHttpOperation,
  partsOfCursor,
  type ProjectedKeyedRow,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { principalKeyOf } from '../assignments/role-assignment-facts.ts';
import { assignmentKeyOf, roleAssignmentsName } from '../assignments/role-assignment-rows.ts';
import { ListedAssignmentSchema } from './role-assignment-shapes.ts';

const ListRoleAssignmentsInputSchema = Schema.Struct({
  limit: EventPagingInputFields.limit,
  cursor: EventPagingInputFields.cursor,
});

const ListedRowSchema = Schema.Struct({
  principal_type: Schema.Literal('person'),
  principal_id: Schema.String,
  role_type: Schema.Literal('built_in'),
  role_id: Schema.String,
  scope_type: Schema.Literals(['org', 'playbook']),
  scope_id: Schema.String,
  source: ListedAssignmentSchema.fields.source,
  assigned_at: Schema.String,
  assigned_by: Schema.String,
});

const listedRowOf = Schema.decodeUnknownSync(ListedRowSchema);

const isCursor = Schema.is(Schema.Tuple([Schema.String, Schema.String]));

export const notACursorOfTheList = 'Expected the next_cursor of a page of list_role_assignments';

function afterOf(cursor: string | undefined): Effect.Effect<readonly string[] | undefined, InvalidInput> {
  if (cursor === undefined) {
    return Effect.undefined;
  }
  const parts = Option.getOrUndefined(partsOfCursor(cursor));
  return isCursor(parts)
    ? Effect.succeed(parts)
    : Effect.fail(
        new InvalidInput({
          detail: notACursorOfTheList,
          issues: [{ pointer: '/cursor', detail: notACursorOfTheList }],
        }),
      );
}

function listedOf({ row }: ProjectedKeyedRow) {
  const listed = listedRowOf(row);
  return {
    principal: { type: listed.principal_type, id: listed.principal_id },
    role: { type: listed.role_type, id: listed.role_id },
    scope: { type: listed.scope_type, id: listed.scope_id },
    source: listed.source,
    assigned_at: listed.assigned_at,
    assigned_by: listed.assigned_by,
  };
}

const listed = Effect.fnUntraced(function* ({
  limit = defaultPageLimit,
  cursor,
}: typeof ListRoleAssignmentsInputSchema.Type) {
  const after = yield* afterOf(cursor);
  const rows = yield* (yield* OrgReader).readProjectedRows(roleAssignmentsName, {
    where: [],
    orderBy: [],
    order: 'asc',
    ...(after === undefined ? {} : { after }),
    limit: limit + 1,
  });
  const page = rows.slice(0, limit).map((row) => listedOf(row));
  const last = page.at(-1);
  const hasMore = rows.length > limit && last !== undefined;
  return {
    role_assignments: page,
    has_more: hasMore,
    next_cursor: hasMore ? cursorOfParts([principalKeyOf(last.principal), assignmentKeyOf(last)]) : null,
  };
});

export const listRoleAssignments = defineHttpOperation('org', 'query', {
  name: 'list_role_assignments',
  title: 'List role assignments',
  description:
    'Lists who holds which role in the org, each person’s role where it holds, how it was given, when and by whom, a page at a time, by ids alone.',
  route: { method: 'GET', path: '/role-assignments' },
  body: { kind: 'none' },
  permittedBy: ['org:read'],
  inputSchema: ListRoleAssignmentsInputSchema,
  outputSchema: Schema.Struct({
    role_assignments: Schema.Array(ListedAssignmentSchema).annotate({
      description: 'The role assignments of the page, by person and then by where each holds',
    }),
    ...PagingOutputFields,
  }),
  reasons: ['invalid_input'],
  handle: listed,
});
