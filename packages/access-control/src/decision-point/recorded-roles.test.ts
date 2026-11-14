import type { ArrivedVia, PrincipalReference } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { assignRole } from '../operations/assign-role.ts';
import { roleAssignmentsRecordedIn } from '../roles/recorded-role-assignments.ts';
import {
  createPlaybook,
  decidedBy,
  getDefinition,
  listConnections,
  requestOf,
  runDefinition,
} from '../testing/access-testing.ts';
import { ada, roleAssignmentCalls } from '../testing/role-assignment-calls.ts';

const acme = { type: 'org', id: 'acme' } as const;

const alpha = { type: 'playbook', id: 'alpha', org: 'acme' } as const;

const keyAndLocalDeveloper: readonly (readonly [PrincipalReference, ArrivedVia])[] = [
  [{ type: 'key', id: 'ci-key' }, 'key'],
  [{ type: 'local_developer', id: 'local' }, 'local'],
];

const asked = [
  [listConnections, acme],
  [createPlaybook, acme],
  [getDefinition, alpha],
  [runDefinition, alpha],
] as const;

describe('the decision point over the read model of role assignments', () => {
  it('decides each person by the role recorded for them, and a signed-in person with no role is allowed nothing', async () => {
    const { imported, call, ledger } = roleAssignmentCalls();
    await imported(['user_ada', 'admin'], ['user_priya', 'editor']);
    await call(assignRole, ada, { person: 'user_priya', role: 'viewer' });
    const decide = decidedBy(roleAssignmentsRecordedIn(ledger.service));

    const decided = await Promise.all(
      ['user_ada', 'user_priya', 'user_dana'].map((id) =>
        Promise.all(
          asked.map(async ([operation, resource]) => {
            const { decision } = await decide(requestOf({ principal: { type: 'person', id }, operation, resource }));
            return decision;
          }),
        ),
      ),
    );

    expect(decided).toEqual([
      ['allow', 'allow', 'allow', 'allow'],
      ['allow', 'deny', 'allow', 'deny'],
      ['deny', 'deny', 'deny', 'deny'],
    ]);
  });

  it('leaves a key and the local developer as they are, bounded by their grant alone, as a runtime in local mode is', async () => {
    const { ledger } = roleAssignmentCalls();
    const decide = decidedBy(roleAssignmentsRecordedIn(ledger.service));

    const decided = await Promise.all(
      keyAndLocalDeveloper.map(([principal, via]) =>
        Promise.all(
          asked.map(async ([operation, resource]) => {
            const { decision } = await decide(requestOf({ principal, operation, resource, via }));
            return decision;
          }),
        ),
      ),
    );

    expect(decided).toEqual([
      ['allow', 'allow', 'allow', 'allow'],
      ['allow', 'allow', 'allow', 'allow'],
    ]);
  });
});
