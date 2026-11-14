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
  type Pair,
} from '../testing/role-assignment-states.ts';
import {
  lastAssigner,
  roleAssignmentDecider,
  type DeprovisioningSource,
  type ProvisioningSource,
  type RolesDeprovisioned,
  type RolesProvisioned,
} from './role-assignment-decider.ts';
import type { AssignedPrincipal } from './role-assignment-facts.ts';

const decide = roleAssignmentDecider.decide;

function provisioned(source: ProvisioningSource, ...pairs: readonly Pair[]): RolesProvisioned {
  return { kind: 'provision', source, scope: acme, assignments: assignmentsOf(...pairs), ...acted };
}

function deprovisioned(source: DeprovisioningSource, principal: AssignedPrincipal): RolesDeprovisioned {
  return { kind: 'deprovision', source, principal, scope: acme, ...acted };
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
