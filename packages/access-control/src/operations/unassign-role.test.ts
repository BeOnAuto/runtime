import { describe, expect, it } from 'vitest';

import { lastAssigner, noRoleThatAssigns } from '../assignments/role-assignment-decider.ts';
import { ada, adasAgent, outputOf, priya, roleAssignmentCalls } from '../testing/role-assignment-calls.ts';
import { onlyInStudio } from './role-assignment-shapes.ts';
import { unassignRole } from './unassign-role.ts';

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
