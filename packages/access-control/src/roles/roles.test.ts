import {
  allPermissions,
  type Decider,
  type Permission,
  type ProjectionReader,
  type ResourceReference,
  streamPrefixOfOrg,
} from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  type RecordedRoleAssignmentEvent,
  type RoleAssignmentEvent,
  RoleAssignmentEventSchema,
  roleAssignmentsStreamOf,
} from '../assignments/role-assignment-facts.ts';
import { roleAssignmentRows } from '../assignments/role-assignment-rows.ts';
import {
  assignARole,
  builtIn,
  createPlaybook,
  decidedBy,
  getDefinition,
  listConnections,
  requestOf,
  rolesHeld,
  runDefinition,
  type TestOperation,
  updateDefinition,
} from '../testing/access-testing.ts';
import {
  builtInRoleIds,
  builtInRoles,
  builtInRolesAtSignIn,
  defaultRoleIds,
  mayAssign,
  mayInvite,
} from './built-in-roles.ts';
import { assignmentsReadAtOnce, roleAssignmentsFrom, roleAssignmentsRecordedIn } from './recorded-role-assignments.ts';
import { editorRoleForEveryPerson } from './role-assignments.ts';

describe('the roles taken in report-only mode', () => {
  it('give every signed-in person the built-in role Editor in the org asked about, and keys, playbooks and the local developer no role', async () => {
    const held = await Effect.runPromise(
      Effect.all([
        editorRoleForEveryPerson.heldBy({ type: 'person', id: 'user_ada' }, 'acme'),
        editorRoleForEveryPerson.heldBy({ type: 'key', id: 'ci-key' }, 'acme'),
        editorRoleForEveryPerson.heldBy({ type: 'playbook', id: 'alpha' }, 'acme'),
        editorRoleForEveryPerson.heldBy({ type: 'local_developer', id: 'local' }, 'acme'),
      ]),
    );

    expect(held).toEqual([
      [{ role: { type: 'built_in', id: 'editor' }, scope: { type: 'org', id: 'acme' } }],
      [],
      [],
      [],
    ]);
  });
});

const acme: ResourceReference = { type: 'org', id: 'acme' };

const alpha: ResourceReference = { type: 'playbook', id: 'alpha', org: 'acme' };

interface Declaring {
  readonly operation: TestOperation;
  readonly resource: ResourceReference;
}

const declaringEach: Readonly<Record<Permission, Declaring>> = {
  'org:read': { operation: listConnections, resource: acme },
  'org:write': { operation: createPlaybook, resource: acme },
  'playbook:read': { operation: getDefinition, resource: alpha },
  'playbook:write': { operation: updateDefinition, resource: alpha },
  'playbook:run': {
    operation: { ...runDefinition, name: 'run_alone', permissions: ['playbook:run'] },
    resource: alpha,
  },
};

describe('the built-in roles the decider reads', () => {
  it('permit what the built-in policies permit them, permission by permission, so the two never disagree', async () => {
    const decide = decidedBy(
      rolesHeld(Object.fromEntries(builtInRoleIds.map((role) => [`user_${role}`, [builtIn(role, acme)]]))),
      Object.values(declaringEach).map(({ operation }) => operation),
    );
    const decided = await Promise.all(
      builtInRoleIds.flatMap((role) =>
        allPermissions.map(async (permission) => {
          const { operation, resource } = declaringEach[permission];
          const { decision } = await decide(
            requestOf({ principal: { type: 'person', id: `user_${role}` }, operation, resource }),
          );
          return [role, permission, decision === 'allow'] as const;
        }),
      ),
    );

    expect(decided).toEqual(
      builtInRoleIds.flatMap((role) =>
        allPermissions.map((permission) => [role, permission, builtInRoles[role].permits.includes(permission)]),
      ),
    );
  });

  it('manage permissions, signed in to Studio, exactly where the table says they give roles, so the decider and the policies never disagree', async () => {
    const decide = decidedBy(
      rolesHeld(Object.fromEntries(builtInRoleIds.map((role) => [`user_${role}`, [builtIn(role, acme)]]))),
    );
    const managing = await Promise.all(
      builtInRoleIds.map(async (role) => {
        const { decision } = await decide(
          requestOf({ principal: { type: 'person', id: `user_${role}` }, operation: assignARole, resource: acme }),
        );
        return [role, decision === 'allow'] as const;
      }),
    );

    expect(managing).toEqual(builtInRoleIds.map((role) => [role, builtInRoles[role].assignsRoles]));
  });

  it('let an admin alone give a role, and an admin give any of them', () => {
    expect(
      builtInRoleIds.flatMap((held) => builtInRoleIds.map((asked) => mayAssign(builtInRoles, held, asked))),
    ).toEqual([true, true, true, true, ...Array.from({ length: 12 }, () => false)]);
  });
});

describe('the roles that invite', () => {
  it('let an admin invite to any of them, an editor invite an editor, an operator or a viewer, and an operator or a viewer invite nobody', () => {
    expect(builtInRoleIds.map((held) => builtInRoleIds.map((asked) => mayInvite(builtInRoles, held, asked)))).toEqual([
      [true, true, true, true],
      [false, true, true, true],
      [false, false, false, false],
      [false, false, false, false],
    ]);
  });
});

describe('the roles given at sign-in', () => {
  it('give the first person to sign in a role that gives roles, and a newcomer the role that permits least', () => {
    const { bootstrap, enrolment } = builtInRolesAtSignIn;
    const fewest = Math.min(...builtInRoleIds.map((role) => builtInRoles[role].permits.length));

    expect([builtInRoles[bootstrap].assignsRoles, builtInRoles[enrolment].permits.length]).toEqual([true, fewest]);
    expect(builtInRoleIds.filter((role) => builtInRoles[role].permits.length === fewest)).toEqual([enrolment]);
  });
});

describe('the roles a default role may be', () => {
  it('are every role that gives no roles, and no other, so a person who joins without an invitation is never an admin', () => {
    expect(defaultRoleIds).toEqual(builtInRoleIds.filter((role) => !builtInRoles[role].assignsRoles));
  });
});

describe('a role that may start a run', () => {
  it('is one that permits a permission running a definition declares: an admin, an editor and an operator, each of whose runs acts on the credential it started with, which no role cuts', () => {
    expect(
      builtInRoleIds.filter((role) =>
        builtInRoles[role].permits.some((permission) => runDefinition.permissions.includes(permission)),
      ),
    ).toEqual(['admin', 'editor', 'operator']);
  });
});

const acmeStream = `${streamPrefixOfOrg({ org: 'acme' })}${roleAssignmentsStreamOf({ type: 'org', id: 'acme' })}`;

const recordedAsGiven: Decider<null, readonly RoleAssignmentEvent[], RecordedRoleAssignmentEvent> = {
  initialState: null,
  evolve: () => null,
  decide: (events) => Result.succeed(events),
  context: () => ({ at: '2026-11-14T09:00:00.000Z', by: 'runtime' }),
  eventSchema: RoleAssignmentEventSchema,
};

function heldAtThePlaybook(playbook: string): RoleAssignmentEvent {
  return {
    type: 'role_assigned',
    data: {
      principal: { type: 'person', id: 'user_priya' },
      role: { type: 'built_in', id: 'editor' },
      scope: { type: 'playbook', id: playbook },
      source: 'manual',
    },
  };
}

function inAppendsOfEight(playbooks: readonly string[]): readonly (readonly RoleAssignmentEvent[])[] {
  return playbooks.flatMap((_playbook, at) =>
    at % 8 === 0 ? [playbooks.slice(at, at + 8).map((playbook) => heldAtThePlaybook(playbook))] : [],
  );
}

async function readModelOf(...appends: readonly (readonly RoleAssignmentEvent[])[]) {
  const ledger = memoryLedger(undefined, [roleAssignmentRows]);
  await Effect.runPromise(
    Effect.forEach(appends, (events) => ledger.service.execute(acmeStream, recordedAsGiven, events)),
  );
  return ledger.service;
}

const adaAnAdmin: RoleAssignmentEvent = {
  type: 'role_assigned',
  data: {
    principal: { type: 'person', id: 'user_ada' },
    role: { type: 'built_in', id: 'admin' },
    scope: { type: 'org', id: 'acme' },
    source: 'import',
  },
};

describe('the roles a principal holds, read from the read model of role assignments', () => {
  it('are the roles recorded for that principal in the org asked about, and none for anyone else or in another org', async () => {
    const roles = roleAssignmentsRecordedIn(await readModelOf([adaAnAdmin]));

    expect(
      await Effect.runPromise(
        Effect.all([
          roles.heldBy({ type: 'person', id: 'user_ada' }, 'acme'),
          roles.heldBy({ type: 'person', id: 'user_ada' }, 'globex'),
          roles.heldBy({ type: 'person', id: 'user_priya' }, 'acme'),
          roles.heldBy({ type: 'key', id: 'user_ada' }, 'acme'),
          roles.heldBy({ type: 'local_developer', id: 'local' }, 'acme'),
        ]),
      ),
    ).toEqual([[{ role: { type: 'built_in', id: 'admin' }, scope: { type: 'org', id: 'acme' } }], [], [], [], []]);
  });

  it('are read a page at a time, however many places they hold a role at', async () => {
    const playbooks = Array.from({ length: assignmentsReadAtOnce * 2 + 1 }, (_each, at) => `playbook-${1000 + at}`);
    const roles = roleAssignmentsRecordedIn(await readModelOf(...inAppendsOfEight(playbooks)));

    const held = await Effect.runPromise(roles.heldBy({ type: 'person', id: 'user_priya' }, 'acme'));

    expect(held.map(({ scope }) => scope.id)).toEqual(playbooks);
  });

  it('fail, so the decision point denies, where a row does not read as an assignment', async () => {
    const malformed: Pick<ProjectionReader, 'readProjectedRows'> = {
      readProjectedRows: () => Effect.succeed([{ org: 'acme', key: 'person:user_ada', row: { role_type: 'custom' } }]),
    };

    const read = await Effect.runPromiseExit(
      roleAssignmentsRecordedIn(malformed).heldBy({ type: 'person', id: 'user_ada' }, 'acme'),
    );

    expect(Exit.hasDies(read)).toBe(true);
  });
});

describe('the switch of the source of roles', () => {
  it('keeps today’s, every person an editor, unless the composition names the role assignments', async () => {
    const reader = await readModelOf([adaAnAdmin]);
    const recorded = roleAssignmentsFrom('role_assignments', reader);

    expect(roleAssignmentsFrom('every_person_an_editor', reader)).toBe(editorRoleForEveryPerson);
    expect(await Effect.runPromise(recorded.heldBy({ type: 'person', id: 'user_priya' }, 'acme'))).toEqual([]);
  });
});
