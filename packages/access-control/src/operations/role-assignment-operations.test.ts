import { describe, expect, it } from 'vitest';

import { roleAssignmentOperations } from './role-assignment-operations.ts';

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
});
