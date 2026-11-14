import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ada, outputOf, roleAssignmentCalls } from '../testing/role-assignment-calls.ts';
import { assignRole } from './assign-role.ts';
import { listRoleAssignments, notACursorOfTheList } from './list-role-assignments.ts';

const PageSchema = Schema.Struct({
  role_assignments: Schema.Array(
    Schema.Struct({
      principal: Schema.Struct({ type: Schema.String, id: Schema.String }),
      role: Schema.Struct({ type: Schema.String, id: Schema.String }),
      scope: Schema.Struct({ type: Schema.String, id: Schema.String }),
      source: Schema.String,
      assigned_at: Schema.String,
      assigned_by: Schema.String,
    }),
  ),
  has_more: Schema.Boolean,
  next_cursor: Schema.NullOr(Schema.String),
});

const pageOf = Schema.decodeUnknownSync(PageSchema);

describe('list_role_assignments', () => {
  it('is a query of the org at GET /role-assignments, over HTTP alone, for a credential that may read the org', () => {
    expect(listRoleAssignments.registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'list_role_assignments',
      route: { method: 'GET', path: '/role-assignments' },
      servedOverHttpAlone: { kind: 'none' },
      permissions: ['org:read'],
    });
  });

  it('lists who holds which role and where, how, when and by whom it was given, by ids alone', async () => {
    const { imported, call } = roleAssignmentCalls();
    await imported(['user_ada', 'admin'], ['user_priya', 'editor']);
    await call(assignRole, ada, { person: 'user_priya', role: 'viewer' }, '2026-11-14T16:30:00.000Z');

    const listed = pageOf(outputOf(await call(listRoleAssignments, { ...ada, permissions: allPermissions }, {})));

    expect(listed).toEqual({
      role_assignments: [
        {
          principal: { type: 'person', id: 'user_ada' },
          role: { type: 'built_in', id: 'admin' },
          scope: { type: 'org', id: 'acme' },
          source: 'import',
          assigned_at: '2026-11-14T09:00:00.000Z',
          assigned_by: 'runtime',
        },
        {
          principal: { type: 'person', id: 'user_priya' },
          role: { type: 'built_in', id: 'viewer' },
          scope: { type: 'org', id: 'acme' },
          source: 'manual',
          assigned_at: '2026-11-14T16:30:00.000Z',
          assigned_by: 'person:user_ada',
        },
      ],
      has_more: false,
      next_cursor: null,
    });
  });
});

describe('the pages of list_role_assignments', () => {
  it('go by person and place, each page reading on after the one before', async () => {
    const { imported, call } = roleAssignmentCalls();
    await imported(['user_ada', 'admin'], ['user_dana', 'viewer'], ['user_priya', 'editor']);

    const first = pageOf(outputOf(await call(listRoleAssignments, ada, { limit: 2 })));
    const second = pageOf(
      outputOf(await call(listRoleAssignments, ada, { limit: 2, cursor: String(first.next_cursor) })),
    );

    expect([first.role_assignments.map(({ principal }) => principal.id), first.has_more]).toEqual([
      ['user_ada', 'user_dana'],
      true,
    ]);
    expect([second.role_assignments.map(({ principal }) => principal.id), second.has_more, second.next_cursor]).toEqual(
      [['user_priya'], false, null],
    );
  });

  it('refuses a cursor that is no next_cursor of its own', async () => {
    const { call } = roleAssignmentCalls();

    expect(await call(listRoleAssignments, ada, { cursor: 'not-a-cursor' })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: notACursorOfTheList,
      issues: [{ pointer: '/cursor', detail: notACursorOfTheList }],
    });
  });
});
