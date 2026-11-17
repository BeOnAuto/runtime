import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { lastAssigner, noRoleThatAssigns } from '../assignments/role-assignment-decider.ts';
import { ada, adasAgent, outputOf, priya, roleAssignmentCalls } from '../testing/role-assignment-calls.ts';
import { assignRole } from './assign-role.ts';
import { listRoleAssignments, notACursorOfTheList } from './list-role-assignments.ts';
import { roleAssignmentOperations } from './role-assignment-operations.ts';
import { onlyInStudio } from './role-assignment-shapes.ts';
import { unassignRole } from './unassign-role.ts';

describe('the operations of role assignments', () => {
  it('list who holds what, give a role and take one away, each served over HTTP alone', () => {
    expect(
      roleAssignmentOperations.map(({ registration }) => [registration.name, registration.servedOverHttpAlone]),
    ).toEqual([
      ['list_role_assignments', { kind: 'none' }],
      ['assign_role', { kind: 'none' }],
      ['unassign_role', { kind: 'none' }],
    ]);
  });

  it('declare that they manage permissions where they give or take a role away, which only an admin may, and not where they list', () => {
    expect(
      roleAssignmentOperations.map(({ registration }) => [registration.name, registration.permissionsManagement]),
    ).toEqual([
      ['list_role_assignments', false],
      ['assign_role', true],
      ['unassign_role', true],
    ]);
  });
});

const noneHeld = (id: string) => ({ principal: { type: 'person', id }, scope: { type: 'org', id: 'acme' }, roles: [] });

describe('unassign_role', () => {
  it('is a command of the org at DELETE /role-assignments/{person}/{role}, over HTTP alone, for a credential that may change the org', () => {
    expect(unassignRole.registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      name: 'unassign_role',
      route: { method: 'DELETE', path: '/role-assignments/{person}/{role}' },
      servedOverHttpAlone: { kind: 'none' },
      permissions: ['org:write'],
    });
  });

  it('takes a role away, and answers the roles the person holds after it, none, whether they held it or not', async () => {
    const { imported, call } = roleAssignmentCalls();
    await imported(['user_ada', 'admin'], ['user_priya', 'editor']);

    const taken = await call(unassignRole, ada, { person: 'user_priya', role: 'editor' });
    const again = await call(unassignRole, ada, { person: 'user_priya', role: 'editor' });

    expect([outputOf(taken), outputOf(again)]).toEqual([noneHeld('user_priya'), noneHeld('user_priya')]);
  });

  it('is refused to a person whose role gives no role, to anyone outside Studio, and from the org’s last admin', async () => {
    const { imported, call } = roleAssignmentCalls();
    await imported(['user_ada', 'admin'], ['user_priya', 'editor']);

    expect(
      await Promise.all([
        call(unassignRole, priya, { person: 'user_ada', role: 'admin' }),
        call(unassignRole, adasAgent, { person: 'user_priya', role: 'editor' }),
        call(unassignRole, ada, { person: 'user_ada', role: 'admin' }),
      ]),
    ).toEqual([
      { status: 'rejected', reason: 'forbidden', detail: noRoleThatAssigns },
      { status: 'rejected', reason: 'forbidden', detail: onlyInStudio },
      { status: 'rejected', reason: 'conflict', detail: lastAssigner, kind: 'unworkable' },
    ]);
  });
});

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
