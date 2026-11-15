import { OrgWriter } from '@on.auto/operations';
import { Effect, HashMap } from 'effect';

import { roleAssignmentDecider, type HeldAssignment, type ProvisioningSource } from './role-assignment-decider.ts';
import { roleAssignmentsStreamOf, roleOfIdentityServiceKey, type AssignmentScope } from './role-assignment-facts.ts';

export const mostImportedInOneAppend = 8;

const noneYet = () => 0;

export interface DeclaredMember {
  readonly person: string;
  readonly roleKey: string;
}

interface ImportedRoles {
  readonly imported: number;
  readonly unchanged: number;
  readonly undeclaredKeys: readonly string[];
}

interface ProvisionedAs {
  readonly at: string;
  readonly by: string;
}

function assignmentOf({ person, roleKey }: DeclaredMember): readonly HeldAssignment[] {
  const role = roleOfIdentityServiceKey.get(roleKey);
  return role === undefined
    ? []
    : [{ principal: { type: 'person', id: person }, role: { type: 'built_in', id: role } }];
}

function inAppendsOfEight(assignments: readonly HeldAssignment[]): readonly (readonly HeldAssignment[])[] {
  return assignments.flatMap((_assignment, at) =>
    at % mostImportedInOneAppend === 0 ? [assignments.slice(at, at + mostImportedInOneAppend)] : [],
  );
}

export const rolesProvisioned = Effect.fnUntraced(function* (
  org: string,
  source: ProvisioningSource,
  assignments: readonly HeldAssignment[],
  { at, by }: ProvisionedAs,
) {
  const writer = yield* OrgWriter;
  const scope: AssignmentScope = { type: 'org', id: org };
  return yield* Effect.reduce(inAppendsOfEight(assignments), noneYet, (count: number, inOneAppend) =>
    writer
      .execute(roleAssignmentsStreamOf(scope), roleAssignmentDecider, {
        kind: 'provision',
        source,
        scope,
        assignments: inOneAppend,
        at,
        by,
      })
      .pipe(
        Effect.map(
          ({ state, decidedOn }) => count + HashMap.size(state.byPrincipal) - HashMap.size(decidedOn.byPrincipal),
        ),
      ),
  );
});

export const rolesImported = Effect.fnUntraced(function* (
  org: string,
  members: readonly DeclaredMember[],
  importedAs: ProvisionedAs,
) {
  const declared = members.flatMap((member) => assignmentOf(member));
  const imported = yield* rolesProvisioned(org, 'import', declared, importedAs);
  const undeclared = members.filter(({ roleKey }) => !roleOfIdentityServiceKey.has(roleKey));
  const result: ImportedRoles = {
    imported,
    unchanged: declared.length - imported,
    undeclaredKeys: [...new Set(undeclared.map(({ roleKey }) => roleKey))].toSorted(),
  };
  return result;
});
