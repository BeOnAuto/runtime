import { decisionLoop, VersionConflict, type DecidedPlace } from '@on.auto/ledger';
import { Conflict, Forbidden, recordingOf, type PrincipalReference } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { builtInRoles, type BuiltInRoleId } from '../roles/built-in-roles.ts';
import {
  beyondYourRole,
  lastAssigner,
  noRoleThatAssigns,
  roleAssignmentDecider,
  roleAssignmentDeciderOver,
  heldAssignmentsIn,
  type HeldAssignment,
  type HeldAssignments,
  type RoleGiven,
  type RoleTaken,
} from './role-assignment-decider.ts';
import {
  RoleAssignmentEventSchema,
  type AssignedPrincipal,
  type AssignmentScope,
  type RecordedRoleAssignmentEvent,
  type RoleAssignmentEvent,
} from './role-assignment-facts.ts';

const acme: AssignmentScope = { type: 'org', id: 'acme' };

const acted = { at: '2026-11-14T15:20:00.000Z', by: 'person:user_ada' };

function person(id: string): AssignedPrincipal {
  return { type: 'person', id };
}

const ada = person('user_ada');
const priya = person('user_priya');
const dana = person('user_dana');

function actor({ id }: AssignedPrincipal): PrincipalReference {
  return { type: 'person', id };
}

function role(id: BuiltInRoleId) {
  return { type: 'built_in', id } as const;
}

type Pair = readonly [AssignedPrincipal, BuiltInRoleId];

function assignmentsOf(...pairs: readonly Pair[]): readonly HeldAssignment[] {
  return pairs.map(([principal, id]) => ({ principal, role: role(id) }));
}

function held(...pairs: readonly Pair[]): HeldAssignments {
  return assignmentsOf(...pairs).reduce(
    (state, assignment) =>
      roleAssignmentDecider.evolve(state, {
        type: 'role_assigned',
        data: { ...assignment, scope: acme, source: 'import' },
        context: acted,
      }),
    roleAssignmentDecider.initialState,
  );
}

function pairsIn(state: HeldAssignments): readonly (readonly [string, string])[] {
  return heldAssignmentsIn(state)
    .map(({ principal, role: { id } }): readonly [string, string] => [principal.id, id])
    .toSorted(([left], [right]) => left.localeCompare(right));
}

function given(by: AssignedPrincipal, to: AssignedPrincipal, id: BuiltInRoleId): RoleGiven {
  return { kind: 'assign', actor: actor(by), principal: to, role: role(id), scope: acme, ...acted };
}

function taken(by: AssignedPrincipal, from: AssignedPrincipal, id: BuiltInRoleId): RoleTaken {
  return { kind: 'unassign', actor: actor(by), principal: from, role: role(id), scope: acme, ...acted };
}

function change(
  type: RoleAssignmentEvent['type'],
  principal: AssignedPrincipal,
  id: BuiltInRoleId,
): RoleAssignmentEvent {
  return { type, data: { principal, role: role(id), scope: acme, source: 'manual' } };
}

const decide = roleAssignmentDecider.decide;

describe('a role given', () => {
  it('is one fact of a role assigned, by hand, where the person held none, given by a person whose role lets them give it', () => {
    expect(decide(given(ada, priya, 'viewer'), held([ada, 'admin']))).toEqual(
      Result.succeed([change('role_assigned', priya, 'viewer')]),
    );
  });

  it('is an unassignment of the role held and an assignment of the new one, in one decision, where the person held another', () => {
    expect(decide(given(ada, priya, 'viewer'), held([ada, 'admin'], [priya, 'editor']))).toEqual(
      Result.succeed([change('role_unassigned', priya, 'editor'), change('role_assigned', priya, 'viewer')]),
    );
  });

  it('is no fact where the person holds that role already', () => {
    expect(decide(given(ada, priya, 'editor'), held([ada, 'admin'], [priya, 'editor']))).toEqual(Result.succeed([]));
  });

  it('is refused to a principal whose roles there give no role, whatever the person holds, a key and the local developer among them', () => {
    const refused = Result.fail(new Forbidden({ detail: noRoleThatAssigns }));
    const state = held([ada, 'admin'], [priya, 'editor'], [dana, 'viewer']);

    expect(decide(given(priya, dana, 'editor'), state)).toEqual(refused);
    expect(decide(given(priya, priya, 'editor'), state)).toEqual(refused);
    expect(decide(given(dana, dana, 'viewer'), state)).toEqual(refused);
    expect(decide({ ...given(ada, dana, 'viewer'), actor: { type: 'key', id: 'ci' } }, state)).toEqual(refused);
    expect(decide({ ...given(ada, dana, 'viewer'), actor: { type: 'local_developer', id: 'local' } }, state)).toEqual(
      refused,
    );
  });

  it('is refused where it would leave the org without an admin, and given where another admin stays', () => {
    expect(decide(given(ada, ada, 'editor'), held([ada, 'admin'], [priya, 'editor']))).toEqual(
      Result.fail(new Conflict({ detail: lastAssigner, kind: 'unworkable' })),
    );
    expect(decide(given(ada, ada, 'editor'), held([ada, 'admin'], [priya, 'admin']))).toEqual(
      Result.succeed([change('role_unassigned', ada, 'admin'), change('role_assigned', ada, 'editor')]),
    );
  });
});

describe('a role taken away', () => {
  it('is one fact of a role unassigned where the person holds it, and no fact where they do not', () => {
    const state = held([ada, 'admin'], [priya, 'editor']);

    expect(decide(taken(ada, priya, 'editor'), state)).toEqual(
      Result.succeed([change('role_unassigned', priya, 'editor')]),
    );
    expect(decide(taken(ada, priya, 'viewer'), state)).toEqual(Result.succeed([]));
    expect(decide(taken(ada, dana, 'viewer'), state)).toEqual(Result.succeed([]));
  });

  it('is refused to a principal whose roles give no role, and from the org’s last admin, themselves among them', () => {
    const state = held([ada, 'admin'], [priya, 'editor']);

    expect(decide(taken(priya, ada, 'admin'), state)).toEqual(
      Result.fail(new Forbidden({ detail: noRoleThatAssigns })),
    );
    expect(decide(taken(ada, ada, 'admin'), state)).toEqual(
      Result.fail(new Conflict({ detail: lastAssigner, kind: 'unworkable' })),
    );
  });
});

describe('a role beyond the giver’s own', () => {
  const viewersAssign = roleAssignmentDeciderOver({
    ...builtInRoles,
    viewer: { ...builtInRoles.viewer, assignsRoles: true },
  });

  it('is never given, taken away or replaced by someone whose role permits less than it does', () => {
    const state = held([dana, 'viewer'], [priya, 'editor']);

    expect(viewersAssign.decide(given(dana, ada, 'viewer'), state)).toEqual(
      Result.succeed([change('role_assigned', ada, 'viewer')]),
    );
    expect(viewersAssign.decide(given(dana, ada, 'editor'), state)).toEqual(
      Result.fail(new Forbidden({ detail: beyondYourRole('editor') })),
    );
    expect(viewersAssign.decide(given(dana, priya, 'viewer'), state)).toEqual(
      Result.fail(new Forbidden({ detail: beyondYourRole('editor') })),
    );
    expect(viewersAssign.decide(taken(dana, priya, 'editor'), state)).toEqual(
      Result.fail(new Forbidden({ detail: beyondYourRole('editor') })),
    );
  });
});

describe('the roles imported', () => {
  it('are each a role assigned, from the import, to a person who holds no role there, once each, and never refused', () => {
    const imported = decide(
      {
        kind: 'import',
        scope: acme,
        assignments: assignmentsOf([ada, 'editor'], [priya, 'admin'], [dana, 'viewer'], [dana, 'admin']),
        ...acted,
      },
      held([ada, 'admin']),
    );

    expect(imported).toEqual(
      Result.succeed([
        { type: 'role_assigned', data: { principal: priya, role: role('admin'), scope: acme, source: 'import' } },
        { type: 'role_assigned', data: { principal: dana, role: role('viewer'), scope: acme, source: 'import' } },
      ]),
    );
  });
});

const recordedAs = recordingOf(RoleAssignmentEventSchema);

function recordedNow(...events: readonly RoleAssignmentEvent[]): readonly RecordedRoleAssignmentEvent[] {
  return events.map((event) => recordedAs(event, acted));
}

function stateOf(facts: readonly RecordedRoleAssignmentEvent[]): HeldAssignments {
  return facts.reduce((state, fact) => roleAssignmentDecider.evolve(state, fact), roleAssignmentDecider.initialState);
}

function aStreamAnotherWriterAppendsTo(first: readonly RecordedRoleAssignmentEvent[]) {
  const recorded = [...first];
  const meanwhile: RoleAssignmentEvent[] = [];
  return {
    landsFirst: (events: readonly RoleAssignmentEvent[]) => {
      meanwhile.push(...events);
    },
    state: () => stateOf(recorded),
    load: () => Effect.sync(() => ({ state: stateOf(recorded), version: recorded.length })),
    append: (_stream: string, events: readonly RoleAssignmentEvent[], place: DecidedPlace) =>
      Effect.suspend(() => {
        recorded.push(...meanwhile.splice(0).map((event) => recordedAs(event, place.context)));
        if (place.expectedVersion !== recorded.length) {
          return Effect.fail(new VersionConflict());
        }
        recorded.push(...events.map((event) => recordedAs(event, place.context)));
        return Effect.void;
      }),
  };
}

describe('the state the decider folds', () => {
  it('holds each assignment given and not since taken away, and the context of a decision is who asked and when', () => {
    const folded = stateOf(
      recordedNow(
        change('role_assigned', ada, 'admin'),
        change('role_assigned', priya, 'editor'),
        change('role_unassigned', priya, 'editor'),
        change('role_assigned', priya, 'viewer'),
      ),
    );

    expect(pairsIn(folded)).toEqual([
      ['user_ada', 'admin'],
      ['user_priya', 'viewer'],
    ]);
    expect(roleAssignmentDecider.context(given(ada, priya, 'viewer'), folded)).toEqual(acted);
  });
});

describe('two changes made at once', () => {
  it('leave the org an admin: the second meets the first in the stream, is decided again on what it wrote, and is refused', async () => {
    const stream = aStreamAnotherWriterAppendsTo(
      recordedNow(change('role_assigned', ada, 'admin'), change('role_assigned', priya, 'admin')),
    );
    stream.landsFirst(Result.getOrThrow(decide(given(priya, priya, 'editor'), stream.state())));
    const loop = decisionLoop(stream.load, stream.append, roleAssignmentDecider);

    const adas = await Effect.runPromise(Effect.result(loop('role-assignments/acme', given(ada, ada, 'editor'))));

    expect(adas).toEqual(Result.fail(new Conflict({ detail: lastAssigner, kind: 'unworkable' })));
    expect(pairsIn(stream.state())).toEqual([
      ['user_ada', 'admin'],
      ['user_priya', 'editor'],
    ]);
  });
});
