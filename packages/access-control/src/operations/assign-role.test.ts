import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { lastAssigner, noRoleThatAssigns } from '../assignments/role-assignment-decider.ts';
import {
  aService,
  ada,
  adasAgent,
  ciKey,
  dana,
  localDeveloper,
  outputOf,
  priya,
  roleAssignmentCalls,
} from '../testing/role-assignment-calls.ts';
import { assignRole, notAPersonOfTheOrg } from './assign-role.ts';
import { onlyInStudio } from './role-assignment-shapes.ts';

function heldBy(id: string, ...roles: readonly string[]) {
  return {
    principal: { type: 'person', id },
    scope: { type: 'org', id: 'acme' },
    roles: roles.map((role) => ({ type: 'built_in', id: role })),
  };
}

describe('assign_role', () => {
  it('is a command of the org at PUT /role-assignments/{person}/{role}, over HTTP alone, for a credential that may change the org', () => {
    expect(assignRole.registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      name: 'assign_role',
      route: { method: 'PUT', path: '/role-assignments/{person}/{role}' },
      servedOverHttpAlone: { kind: 'none' },
      permissions: ['org:write'],
    });
  });

  it('gives a person a role in place of the one they held, and answers the roles they hold after it', async () => {
    const { imported, call } = roleAssignmentCalls();
    await imported(['user_ada', 'admin'], ['user_priya', 'editor']);

    const given = await call(assignRole, ada, { person: 'user_priya', role: 'viewer' });
    const again = await call(assignRole, ada, { person: 'user_priya', role: 'viewer' });
    const another = await call(assignRole, ada, { person: 'user_dana', role: 'admin' });

    expect(outputOf(given)).toEqual(heldBy('user_priya', 'viewer'));
    expect(outputOf(again)).toEqual(heldBy('user_priya', 'viewer'));
    expect(outputOf(another)).toEqual(heldBy('user_dana', 'admin'));
  });
});

describe('assign_role refused', () => {
  it('to a person whose role gives no role', async () => {
    const { imported, call } = roleAssignmentCalls();
    await imported(['user_ada', 'admin'], ['user_priya', 'editor'], ['user_dana', 'viewer']);

    expect(
      await Promise.all([
        call(assignRole, priya, { person: 'user_priya', role: 'admin' }),
        call(assignRole, dana, { person: 'user_dana', role: 'editor' }),
      ]),
    ).toEqual([
      { status: 'rejected', reason: 'forbidden', detail: noRoleThatAssigns },
      { status: 'rejected', reason: 'forbidden', detail: noRoleThatAssigns },
    ]);
  });

  it('to anyone but a person signed in to Studio: an agent, a key, the local developer and a caller of no kind', async () => {
    const { imported, call } = roleAssignmentCalls();
    await imported(['user_ada', 'admin']);

    const asked = await Promise.all(
      [adasAgent, ciKey, localDeveloper, aService].map((caller) =>
        call(assignRole, caller, { person: 'user_priya', role: 'viewer' }),
      ),
    );

    expect(asked).toEqual(
      Array.from({ length: 4 }, () => ({ status: 'rejected', reason: 'forbidden', detail: onlyInStudio })),
    );
  });

  it('for someone who is no person of the org', async () => {
    const { imported, call } = roleAssignmentCalls((_org, person) => Effect.succeed(person !== 'person:user_lee'));
    await imported(['user_ada', 'admin']);

    expect(await call(assignRole, ada, { person: 'user_lee', role: 'viewer' })).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: notAPersonOfTheOrg,
    });
  });
});

describe('assign_role and what holds whoever asks', () => {
  it('never leaves the org without an admin', async () => {
    const { imported, call } = roleAssignmentCalls();
    await imported(['user_ada', 'admin'], ['user_priya', 'editor']);

    expect(await call(assignRole, ada, { person: 'user_ada', role: 'editor' })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: lastAssigner,
      kind: 'unworkable',
    });
  });

  it('refuses a role the runtime does not ship', async () => {
    const { imported, call } = roleAssignmentCalls();
    await imported(['user_ada', 'admin']);

    expect(await call(assignRole, ada, { person: 'user_priya', role: 'member' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
    });
  });
});
