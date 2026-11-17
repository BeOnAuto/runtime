import { allPermissions, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { cedarModuleBundled } from '../engine/cedar-module-bundled.ts';
import { editorRoleForEveryPerson, type RoleAssignments } from '../roles/role-assignments.ts';
import { builtIn, cedarOnDisk, filesOnDisk } from '../testing/access-testing.ts';
import { pinnedTableBehaviour } from '../testing/pinned-table-behaviour.ts';
import {
  calls,
  callsOf,
  decidedInstead,
  decisionPointOver,
  keysPlaybooksAndTheLocalDeveloper,
  person,
} from '../testing/report-only-agreement-calls.ts';
import { cedarDecisionPoint, loadedMessage } from './cedar-decision-point.ts';

const moduleOfABundle = cedarModuleBundled(async () => ({ default: await cedarOnDisk() }));

pinnedTableBehaviour('the engine Node loads', (parts) =>
  cedarDecisionPoint({ module: cedarOnDisk, files: filesOnDisk, ...parts }),
);

pinnedTableBehaviour('the engine a bundle hands over compiled, as a Worker loads it', (parts) =>
  cedarDecisionPoint({ module: moduleOfABundle, files: filesOnDisk, ...parts }),
);

const viewerRoleForEveryPerson: RoleAssignments = {
  heldBy: (principal, org) =>
    Effect.succeed(principal.type === 'person' ? [builtIn('viewer', { type: 'org', id: org })] : []),
};

function cutToReading(caller: CallerIdentity): CallerIdentity {
  return { ...caller, permissions: caller.permissions.filter((permission) => permission.endsWith(':read')) };
}

function decisionOf(outcome: Outcome): string {
  return outcome.status === 'rejected' ? `rejected ${outcome.reason}` : outcome.status;
}

function countedByKind(outcomes: readonly Outcome[]): Readonly<Record<string, number>> {
  const counted = new Map<string, number>();
  for (const outcome of outcomes) {
    const kind = outcome.status === 'rejected' && outcome.kind !== undefined ? ` ${outcome.kind}` : '';
    counted.set(`${decisionOf(outcome)}${kind}`, (counted.get(`${decisionOf(outcome)}${kind}`) ?? 0) + 1);
  }
  return Object.fromEntries(counted);
}

describe('the dispatcher decided by the decision point, with the built-in policies and every person taken as an Editor', () => {
  it('answers every call exactly as the check that decides it today, in the same words, and logs nothing undecided', async () => {
    const { today, decided, logged } = await decidedInstead(calls, decisionPointOver(editorRoleForEveryPerson));

    expect(decided).toEqual(today);
    expect(logged).toEqual([loadedMessage]);
  });
});

describe('the dispatcher decided by the decision point, with every person taken as a Viewer whose credential grants everything', () => {
  it('allows and refuses what the check allows and refuses a credential cut to reading, and refuses for the role what reading does not permit', async () => {
    const granted = [
      person('acme', allPermissions),
      person('acme', allPermissions, true),
      person('globex', allPermissions),
    ];
    const { today } = await decidedInstead(
      callsOf([...granted.map((caller) => cutToReading(caller)), ...keysPlaybooksAndTheLocalDeveloper]),
      decisionPointOver(viewerRoleForEveryPerson),
    );
    const { decided, logged } = await decidedInstead(
      callsOf([...granted, ...keysPlaybooksAndTheLocalDeveloper]),
      decisionPointOver(viewerRoleForEveryPerson),
    );

    expect(decided.map((outcome) => decisionOf(outcome))).toEqual(today.map((outcome) => decisionOf(outcome)));
    expect(countedByKind(decided)).toEqual({
      succeeded: 76,
      'rejected invalid_input': 53,
      'rejected forbidden': 255,
      'rejected forbidden permission_denied': 57,
    });
    expect(countedByKind(decided.slice(0, 3 * 49))['rejected forbidden permission_denied']).toBe(57);
    expect(logged).toEqual([loadedMessage]);
  });
});
