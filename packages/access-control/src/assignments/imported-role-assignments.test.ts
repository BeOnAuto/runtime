import { OrgWriter, streamPrefixOfOrg, type StreamWriter } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  mostImportedInOneAppend,
  roleOfIdentityServiceKey,
  rolesImported,
  type DeclaredMember,
} from './imported-role-assignments.ts';
import { heldAssignmentsIn, roleAssignmentDecider, type HeldAssignments } from './role-assignment-decider.ts';
import { roleAssignmentsStreamOf } from './role-assignment-facts.ts';
import { roleAssignmentRows } from './role-assignment-rows.ts';

const importedAs = { at: '2026-11-14T09:00:00.000Z', by: 'runtime' };

const acmeStream = roleAssignmentsStreamOf({ type: 'org', id: 'acme' });

function importing() {
  const ledger = memoryLedger(undefined, [roleAssignmentRows]);
  const appends = { made: 0 };
  const writer: StreamWriter = {
    execute: (stream, decider, command, lineage) => {
      appends.made += 1;
      return ledger.service.execute(`${streamPrefixOfOrg({ org: 'acme' })}${stream}`, decider, command, lineage);
    },
  };
  const run = <A, E>(effect: Effect.Effect<A, E, OrgWriter>) =>
    Effect.runPromise(effect.pipe(Effect.provideService(OrgWriter, writer)));
  return {
    appends,
    imported: (members: readonly DeclaredMember[]) => run(rolesImported('acme', members, importedAs)),
    held: () =>
      Effect.runPromise(
        Effect.map(
          ledger.service.load(`${streamPrefixOfOrg({ org: 'acme' })}${acmeStream}`, roleAssignmentDecider),
          ({ state }): HeldAssignments => state,
        ),
      ),
  };
}

function rolesIn(state: HeldAssignments): readonly (readonly [string, string])[] {
  return heldAssignmentsIn(state).map(({ principal, role }): readonly [string, string] => [principal.id, role.id]);
}

describe('the identity service’s role keys', () => {
  it('are read through one table: org:admin is an admin and org:member an editor, and nothing else is read', () => {
    expect([...roleOfIdentityServiceKey]).toEqual([
      ['org:admin', 'admin'],
      ['org:member', 'editor'],
    ]);
  });
});

describe('the roles imported on ship day', () => {
  it('give each member the role their declared key names, from the import, and nobody whose key the table does not name', async () => {
    const { imported, held } = importing();

    const outcome = await imported([
      { person: 'user_ada', roleKey: 'org:admin' },
      { person: 'user_priya', roleKey: 'org:member' },
      { person: 'user_dana', roleKey: 'org:billing' },
      { person: 'user_lee', roleKey: 'Admin' },
      { person: 'user_kim', roleKey: 'org:billing' },
    ]);

    expect(outcome).toEqual({ imported: 2, unchanged: 0, undeclaredKeys: ['Admin', 'org:billing'] });
    expect(rolesIn(await held())).toEqual([
      ['user_ada', 'admin'],
      ['user_priya', 'editor'],
    ]);
  });

  it('change nothing when run again, nor for anyone who holds a role already', async () => {
    const { imported, held } = importing();
    const members = [
      { person: 'user_ada', roleKey: 'org:admin' },
      { person: 'user_priya', roleKey: 'org:member' },
    ];
    await imported(members);

    const again = await imported([...members, { person: 'user_ada', roleKey: 'org:member' }]);

    expect(again).toEqual({ imported: 0, unchanged: 3, undeclaredKeys: [] });
    expect(rolesIn(await held())).toEqual([
      ['user_ada', 'admin'],
      ['user_priya', 'editor'],
    ]);
  });

  it('are written in appends of at most eight, the most a store takes in one', async () => {
    const { imported, appends, held } = importing();
    const members = Array.from({ length: mostImportedInOneAppend * 2 + 3 }, (_each, at) => ({
      person: `user_${at}`,
      roleKey: 'org:member',
    }));

    const outcome = await imported(members);

    expect([outcome.imported, appends.made]).toEqual([19, 3]);
    expect(heldAssignmentsIn(await held())).toHaveLength(19);
  });
});
