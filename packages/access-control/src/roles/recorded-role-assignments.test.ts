import { streamPrefixOfOrg, type Decider, type ProjectionReader } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  RoleAssignmentEventSchema,
  roleAssignmentsStreamOf,
  type RecordedRoleAssignmentEvent,
  type RoleAssignmentEvent,
} from '../assignments/role-assignment-facts.ts';
import { roleAssignmentRows } from '../assignments/role-assignment-rows.ts';
import { assignmentsReadAtOnce, roleAssignmentsFrom, roleAssignmentsRecordedIn } from './recorded-role-assignments.ts';
import { editorRoleForEveryPerson } from './role-assignments.ts';

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
