import { checkedProjection, streamPrefixOfOrg, type ProjectedRowsQuery } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { roleAssignmentDecider, type RoleAssignmentCommand } from './role-assignment-decider.ts';
import { roleAssignmentsStreamOf, type AssignedPrincipal, type AssignmentScope } from './role-assignment-facts.ts';
import { roleAssignmentRows, roleAssignmentsName } from './role-assignment-rows.ts';

const acme: AssignmentScope = { type: 'org', id: 'acme' };

const ada: AssignedPrincipal = { type: 'person', id: 'user_ada' };

const priya: AssignedPrincipal = { type: 'person', id: 'user_priya' };

const every: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 10 };

const imported: RoleAssignmentCommand = {
  kind: 'import',
  scope: acme,
  assignments: [
    { principal: ada, role: { type: 'built_in', id: 'admin' } },
    { principal: priya, role: { type: 'built_in', id: 'editor' } },
  ],
  at: '2026-11-14T09:00:00.000Z',
  by: 'runtime',
};

const madeAViewer: RoleAssignmentCommand = {
  kind: 'assign',
  actor: { type: 'person', id: 'user_ada' },
  principal: priya,
  role: { type: 'built_in', id: 'viewer' },
  scope: acme,
  at: '2026-11-14T10:30:00.000Z',
  by: 'person:user_ada',
};

const adaAnAdmin = {
  org: 'acme',
  key: 'person:user_ada',
  child: 'org/acme/built_in/admin',
  row: {
    principal_type: 'person',
    principal_id: 'user_ada',
    role_type: 'built_in',
    role_id: 'admin',
    scope_type: 'org',
    scope_id: 'acme',
    source: 'import',
    assigned_at: '2026-11-14T09:00:00.000Z',
    assigned_by: 'runtime',
  },
};

const priyaAViewer = {
  org: 'acme',
  key: 'person:user_priya',
  child: 'org/acme/built_in/viewer',
  row: {
    principal_type: 'person',
    principal_id: 'user_priya',
    role_type: 'built_in',
    role_id: 'viewer',
    scope_type: 'org',
    scope_id: 'acme',
    source: 'manual',
    assigned_at: '2026-11-14T10:30:00.000Z',
    assigned_by: 'person:user_ada',
  },
};

function recordedIn(...commands: readonly RoleAssignmentCommand[]) {
  const ledger = memoryLedger(undefined, [roleAssignmentRows]);
  const stream = `${streamPrefixOfOrg({ org: 'acme' })}${roleAssignmentsStreamOf(acme)}`;
  return Effect.runPromise(
    Effect.forEach(commands, (command) => ledger.service.execute(stream, roleAssignmentDecider, command)).pipe(
      Effect.andThen(ledger.service.readProjectedRows(roleAssignmentsName, { org: 'acme' }, every)),
    ),
  );
}

describe('the read model of role assignments', () => {
  it('is a projection of the org’s role-assignments streams, a row for each role a principal holds and where, under the principal', () => {
    expect(checkedProjection(roleAssignmentRows)).toMatchObject({
      name: 'role_assignments',
      version: 1,
      scopes: ['org'],
      kinds: ['role-assignments'],
      types: ['role_assigned', 'role_unassigned'],
    });
  });

  it('keeps each assignment given with how, when and by whom, and drops one taken away in the same append that gives the next', async () => {
    expect(await recordedIn(imported, madeAViewer)).toEqual([adaAnAdmin, priyaAViewer]);
  });

  it('changes nothing for a role taken away that the principal does not hold there', () => {
    const message = {
      id: 'b7e1f0c2-3a4d-5e6f-8a9b-0c1d2e3f4a5b',
      position: 1,
      type: 'role_unassigned',
      data: { principal: priya, role: { type: 'built_in', id: 'viewer' }, scope: acme, source: 'manual' },
      context: { at: '2026-11-14T10:30:00.000Z', by: 'person:user_ada' },
    };

    expect(roleAssignmentRows.keyOf?.(message, { kind: 'role-assignments', id: 'x' })).toBe('person:user_priya');
    expect(roleAssignmentRows.rowsAfter(new Map(), message)).toBeUndefined();
  });
});
