import { decisionLoop } from '@on.auto/ledger';
import { Conflict, Forbidden, OrgWriter } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { builtInRoles, builtInRolesAtSignIn } from '../roles/built-in-roles.ts';
import {
  aStreamAnotherWriterAppendsTo,
  acme,
  acted,
  ada,
  change,
  dana,
  given,
  held,
  pairsIn,
  priya,
  recordedNow,
  stateOf,
  taken,
} from '../testing/role-assignment-states.ts';
import { adminRecovered } from './recovered-admin.ts';
import type { AdminRecovered } from './role-assignment-commands.ts';
import {
  beyondYourRole,
  enrolledAs,
  lastAssigner,
  noRoleThatAssigns,
  roleAssignmentDecider,
  roleAssignmentDeciderOver,
} from './role-assignment-decider.ts';

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
  const viewersAssign = roleAssignmentDeciderOver(
    { ...builtInRoles, viewer: { ...builtInRoles.viewer, assignsRoles: true } },
    builtInRolesAtSignIn,
  );

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

  it('keeps how the last role of a person who now holds none was ended, and nothing of one who never held a role', () => {
    const folded = stateOf(
      recordedNow(
        change('role_assigned', ada, 'admin'),
        change('role_assigned', priya, 'editor'),
        change('role_unassigned', priya, 'editor'),
        change('role_unassigned', dana, 'viewer'),
      ),
    );

    expect([enrolledAs(folded, priya), enrolledAs(folded, dana)]).toEqual(['removed', 'enrolment']);
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

  it('are both recorded where the second still holds once decided again on what the first wrote', async () => {
    const stream = aStreamAnotherWriterAppendsTo(
      recordedNow(change('role_assigned', ada, 'admin'), change('role_assigned', priya, 'admin')),
    );
    stream.landsFirst(Result.getOrThrow(decide(given(priya, dana, 'viewer'), stream.state())));
    const loop = decisionLoop(stream.load, stream.append, roleAssignmentDecider);

    await Effect.runPromise(loop('role-assignments/acme', given(ada, priya, 'editor')));

    expect(pairsIn(stream.state())).toEqual([
      ['user_ada', 'admin'],
      ['user_dana', 'viewer'],
      ['user_priya', 'editor'],
    ]);
  });
});

function recovered(principal: AdminRecovered['principal']): AdminRecovered {
  return { kind: 'recover', principal, scope: acme, ...acted, by: 'command' };
}

describe('an admin recovered by a command of whoever runs the server', () => {
  it('is given the role the first sign-in gives, by command, in place of the roles they hold, while others hold it, ending nobody else’s', () => {
    expect(decide(recovered(priya), held([ada, 'admin'], [priya, 'editor'], [dana, 'viewer']))).toEqual(
      Result.succeed([
        change('role_unassigned', priya, 'editor', 'command'),
        change('role_assigned', priya, 'admin', 'command'),
      ]),
    );
    expect(decide(recovered(dana), held())).toEqual(
      Result.succeed([change('role_assigned', dana, 'admin', 'command')]),
    );
  });

  it('is given it after an admin removed them, and nothing is recorded where they hold it already', () => {
    const removed = stateOf(
      recordedNow(
        change('role_assigned', ada, 'admin'),
        change('role_assigned', priya, 'viewer'),
        change('role_unassigned', priya, 'viewer'),
      ),
    );

    expect(decide(recovered(priya), removed)).toEqual(
      Result.succeed([change('role_assigned', priya, 'admin', 'command')]),
    );
    expect(decide(recovered(ada), held([ada, 'admin'], [ada, 'editor']))).toEqual(Result.succeed([]));
  });

  it('answers through the org’s writer whether the role was given or held already, recording each once', async () => {
    const { service } = memoryLedger();
    const writer = OrgWriter.of({
      execute: (stream, decider, command, lineage) => service.execute(`org/acme/${stream}`, decider, command, lineage),
    });
    const asked = Effect.provideService(
      adminRecovered('acme', priya.id, { ...acted, by: 'command' }),
      OrgWriter,
      writer,
    );

    expect(await Effect.runPromise(Effect.all([asked, asked]))).toEqual(['given', 'held_already']);
  });
});
