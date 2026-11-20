import { decisionLoop } from '@on.auto/ledger';
import { Conflict } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  aStreamAnotherWriterAppendsTo,
  acme,
  acted,
  ada,
  afterward,
  assignmentsOf,
  change,
  dana,
  given,
  held,
  pairsIn,
  priya,
  recordedNow,
  stateOf,
  taken,
  type Pair,
} from '../testing/role-assignment-states.ts';
import type {
  DeprovisioningSource,
  PersonEnrolled,
  ProvisioningSource,
  RolesDeprovisioned,
  RolesProvisioned,
} from './role-assignment-commands.ts';
import { lastAssigner, roleAssignmentDecider } from './role-assignment-decider.ts';
import type { AssignedPrincipal } from './role-assignment-facts.ts';
import { awaitsItsFirstAdmin, enrolledAs } from './sign-in-decisions.ts';

const decide = roleAssignmentDecider.decide;

function provisioned(source: ProvisioningSource, ...pairs: readonly Pair[]): RolesProvisioned {
  return { kind: 'provision', source, scope: acme, assignments: assignmentsOf(...pairs), ...acted };
}

function deprovisioned(source: DeprovisioningSource, principal: AssignedPrincipal): RolesDeprovisioned {
  return { kind: 'deprovision', source, principal, scope: acme, ...acted };
}

function enrolled(principal: AssignedPrincipal): PersonEnrolled {
  return { kind: 'enrol', principal, scope: acme, ...acted };
}

describe('the roles provisioned to people who hold none', () => {
  it('are each a role assigned, from the source named, to a person who holds no role there, once each, and never refused', () => {
    const provisioning = provisioned('import', [ada, 'editor'], [priya, 'admin'], [dana, 'viewer'], [dana, 'admin']);

    expect(decide(provisioning, held([ada, 'admin']))).toEqual(
      Result.succeed([
        change('role_assigned', priya, 'admin', 'import'),
        change('role_assigned', dana, 'viewer', 'import'),
      ]),
    );
  });

  it('carry the source they are given, each of the sources that is no person’s act', () => {
    const sources: readonly ProvisioningSource[] = ['invitation', 'enrolment', 'identity_service', 'import', 'command'];

    expect(sources.map((source) => decide(provisioned(source, [priya, 'editor']), held([ada, 'admin'])))).toEqual(
      sources.map((source) => Result.succeed([change('role_assigned', priya, 'editor', source)])),
    );
  });
});

describe('the roles provisioned to people who hold one already', () => {
  it('give nothing to a person who holds a role there already, where the org holds an admin, whatever the role asked', () => {
    const state = held([ada, 'admin'], [priya, 'viewer'], [dana, 'editor']);

    expect(decide(provisioned('identity_service', [priya, 'admin'], [dana, 'viewer'], [ada, 'editor']), state)).toEqual(
      Result.succeed([]),
    );
  });

  it('make a person who holds another role an admin where the org holds none, the role held taken away in the same decision', () => {
    const state = held([priya, 'editor'], [dana, 'viewer']);

    expect(decide(provisioned('identity_service', [priya, 'admin'], [dana, 'admin']), state)).toEqual(
      Result.succeed([
        change('role_unassigned', priya, 'editor', 'identity_service'),
        change('role_assigned', priya, 'admin', 'identity_service'),
        change('role_unassigned', dana, 'viewer', 'identity_service'),
        change('role_assigned', dana, 'admin', 'identity_service'),
      ]),
    );
  });

  it('never change the role of a person who holds one to a role that gives no roles, even where the org holds no admin', () => {
    const state = held([priya, 'viewer'], [dana, 'editor']);

    expect(decide(provisioned('identity_service', [priya, 'editor'], [dana, 'viewer']), state)).toEqual(
      Result.succeed([]),
    );
  });

  it('change nothing when the same are provisioned again', () => {
    const state = held([priya, 'editor']);
    const provisioning = provisioned('identity_service', [priya, 'admin'], [dana, 'viewer']);

    expect(decide(provisioning, afterward(state, Result.getOrThrow(decide(provisioning, state))))).toEqual(
      Result.succeed([]),
    );
  });
});

describe('a person deprovisioned', () => {
  it('has every assignment they hold there ended, from the source named, and nothing where they hold none', () => {
    const state = held([ada, 'admin'], [priya, 'editor'], [priya, 'viewer']);

    expect(decide(deprovisioned('manual', priya), state)).toEqual(
      Result.succeed([
        change('role_unassigned', priya, 'editor', 'manual'),
        change('role_unassigned', priya, 'viewer', 'manual'),
      ]),
    );
    expect(decide(deprovisioned('identity_service', priya), state)).toEqual(
      Result.succeed([
        change('role_unassigned', priya, 'editor', 'identity_service'),
        change('role_unassigned', priya, 'viewer', 'identity_service'),
      ]),
    );
    expect(decide(deprovisioned('manual', dana), state)).toEqual(Result.succeed([]));
  });

  it('by a removal asked through Auto, is refused where it would leave the org without an admin, and done where another admin stays', () => {
    expect(decide(deprovisioned('manual', ada), held([ada, 'admin'], [priya, 'editor']))).toEqual(
      Result.fail(new Conflict({ detail: lastAssigner, kind: 'unworkable' })),
    );
    expect(decide(deprovisioned('manual', ada), held([ada, 'admin'], [priya, 'admin']))).toEqual(
      Result.succeed([change('role_unassigned', ada, 'admin', 'manual')]),
    );
  });

  it('by the identity service, is recorded where it leaves the org without an admin, so a departed admin no longer counts and one marked admin there can be made one', () => {
    const state = held([ada, 'admin'], [priya, 'editor']);
    const departed = Result.getOrThrow(decide(deprovisioned('identity_service', ada), state));

    expect(departed).toEqual([change('role_unassigned', ada, 'admin', 'identity_service')]);
    expect(decide(provisioned('identity_service', [priya, 'admin']), afterward(state, departed))).toEqual(
      Result.succeed([
        change('role_unassigned', priya, 'editor', 'identity_service'),
        change('role_assigned', priya, 'admin', 'identity_service'),
      ]),
    );
  });

  it('changes nothing when deprovisioned again', () => {
    const state = held([ada, 'admin'], [priya, 'editor']);
    const once = Result.getOrThrow(decide(deprovisioned('identity_service', priya), state));

    expect(decide(deprovisioned('identity_service', priya), afterward(state, once))).toEqual(Result.succeed([]));
  });
});

describe('a removal asked through Auto and a change of role made at once', () => {
  it('leave the org an admin: the removal meets the change in the stream, is decided again on what it wrote, and is refused', async () => {
    const stream = aStreamAnotherWriterAppendsTo(
      recordedNow(change('role_assigned', ada, 'admin'), change('role_assigned', priya, 'admin')),
    );
    stream.landsFirst(Result.getOrThrow(decide(given(priya, priya, 'editor'), stream.state())));
    const loop = decisionLoop(stream.load, stream.append, roleAssignmentDecider);

    const removal = await Effect.runPromise(Effect.result(loop('role-assignments/acme', deprovisioned('manual', ada))));

    expect(removal).toEqual(Result.fail(new Conflict({ detail: lastAssigner, kind: 'unworkable' })));
    expect(pairsIn(stream.state())).toEqual([
      ['user_ada', 'admin'],
      ['user_priya', 'editor'],
    ]);
  });
});

describe('a person who signs in, where nobody holds a role that gives roles', () => {
  it('is given the role that gives roles, by bootstrap, in place of any role they hold there, and the org then holds its first admin', () => {
    const bootstrapped = Result.getOrThrow(decide(enrolled(priya), held([priya, 'viewer'])));

    expect(decide(enrolled(ada), held())).toEqual(Result.succeed([change('role_assigned', ada, 'admin', 'bootstrap')]));
    expect(bootstrapped).toEqual([
      change('role_unassigned', priya, 'viewer', 'bootstrap'),
      change('role_assigned', priya, 'admin', 'bootstrap'),
    ]);
    expect(
      [held(), afterward(held([priya, 'viewer']), bootstrapped)].map((state) => awaitsItsFirstAdmin(state)),
    ).toEqual([true, false]);
  });
});

describe('the state the decider folds, read at sign-in', () => {
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

describe('a person who signs in, where someone gives roles', () => {
  it('is given the lowest role, by enrolment, the first time, and nothing at every later sign-in, whatever they hold', () => {
    const state = held([ada, 'admin'], [dana, 'editor']);
    const first = Result.getOrThrow(decide(enrolled(priya), state));

    expect(first).toEqual([change('role_assigned', priya, 'viewer', 'enrolment')]);
    expect(
      [enrolled(priya), enrolled(dana), enrolled(ada)].map((command) => decide(command, afterward(state, first))),
    ).toEqual([Result.succeed([]), Result.succeed([]), Result.succeed([])]);
    expect([priya, dana].map((principal) => enrolledAs(state, principal))).toEqual(['enrolment', 'member']);
  });

  it('is given nothing once an admin removed them, by a removal or by taking away the role they held, until an admin gives them a role again', () => {
    const state = held([ada, 'admin'], [priya, 'editor'], [dana, 'viewer']);
    const removed = afterward(state, [
      ...Result.getOrThrow(decide(deprovisioned('manual', priya), state)),
      ...Result.getOrThrow(decide(taken(ada, dana, 'viewer'), state)),
    ]);
    const givenAgain = afterward(removed, Result.getOrThrow(decide(given(ada, priya, 'viewer'), removed)));

    expect([enrolled(priya), enrolled(dana)].map((command) => decide(command, removed))).toEqual([
      Result.succeed([]),
      Result.succeed([]),
    ]);
    expect([enrolledAs(removed, priya), enrolledAs(removed, dana), enrolledAs(givenAgain, priya)]).toEqual([
      'removed',
      'removed',
      'member',
    ]);
  });

  it('is given the lowest role where the identity service, not an admin, ended the role they held', () => {
    const state = held([ada, 'admin'], [priya, 'editor']);
    const left = afterward(state, Result.getOrThrow(decide(deprovisioned('identity_service', priya), state)));

    expect(decide(enrolled(priya), left)).toEqual(
      Result.succeed([change('role_assigned', priya, 'viewer', 'enrolment')]),
    );
  });
});

describe('two people signing in at once where nobody holds a role that gives roles', () => {
  it('give exactly one admin: the second meets the first in the stream, is decided again on what it wrote, and is given the lowest role', async () => {
    const stream = aStreamAnotherWriterAppendsTo([]);
    stream.landsFirst(Result.getOrThrow(decide(enrolled(ada), stream.state())));
    const loop = decisionLoop(stream.load, stream.append, roleAssignmentDecider);

    const priyas = await Effect.runPromise(loop('role-assignments/acme', enrolled(priya)));

    expect(enrolledAs(priyas.loaded.state, priya)).toBe('enrolment');
    expect(priyas.events.map(({ type, data }) => ({ type, data }))).toEqual([
      change('role_assigned', priya, 'viewer', 'enrolment'),
    ]);
    expect(pairsIn(stream.state())).toEqual([
      ['user_ada', 'admin'],
      ['user_priya', 'viewer'],
    ]);
  });
});
