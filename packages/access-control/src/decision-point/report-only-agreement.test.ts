import {
  type AccessRequest,
  allPermissions,
  type CallerIdentity,
  type Permission,
  type PolicyDecisionPoint,
} from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { editorRoleForEveryPerson, type RoleAssignments } from '../roles/role-assignments.ts';
import { builtIn } from '../testing/access-testing.ts';
import {
  askedInReportOnly,
  calls,
  callsOf,
  countedByReason,
  decisionPointOver,
  keysPlaybooksAndTheLocalDeveloper,
  person,
} from '../testing/report-only-agreement-calls.ts';
import { loadedMessage } from './cedar-decision-point.ts';

describe('the decision point in report-only mode, with the built-in policies and every person taken as an Editor', () => {
  it('decides every call as the check that decides it today, so the dispatcher logs no difference and answers as it did', async () => {
    const { today, reported, asked, logged } = await askedInReportOnly(
      calls,
      decisionPointOver(editorRoleForEveryPerson),
    );

    expect(calls.length).toBe(11 * (5 * 2 * 4 + 3 * 3));
    expect(reported).toEqual(today);
    expect(countedByReason(today)).toEqual({
      succeeded: 89,
      'rejected invalid_input': 61,
      'rejected forbidden': 389,
    });
    expect(asked).toBe(calls.length);
    expect(logged).toEqual([loadedMessage]);
  });
});

const reading: readonly Permission[] = ['org:read', 'playbook:read'];

function cutToReading(caller: CallerIdentity): CallerIdentity {
  return { ...caller, permissions: caller.permissions.filter((permission) => reading.includes(permission)) };
}

const personsGrantedEverything: readonly CallerIdentity[] = [
  person('acme', allPermissions),
  person('acme', allPermissions, true),
  person('globex', allPermissions),
];

const persons: readonly CallerIdentity[] = [
  ...personsGrantedEverything,
  person('acme', reading, true),
  person('acme', ['playbook:write'], true),
  person('acme', []),
];

const viewerRoleForEveryPerson: RoleAssignments = {
  heldBy: (principal, org) =>
    Effect.succeed(principal.type === 'person' ? [builtIn('viewer', { type: 'org', id: org })] : []),
};

function grantedEverything(request: AccessRequest): AccessRequest {
  const { context } = request;
  return { ...request, context: { ...context, granted: { ...context.granted, permissions: allPermissions } } };
}

function decidingOnAnUncutGrant(decisionPoint: PolicyDecisionPoint): PolicyDecisionPoint {
  return {
    decide: (request) =>
      decisionPoint.decide(request.principal.type === 'person' ? grantedEverything(request) : request),
  };
}

describe('the decision point in report-only mode, with every person taken as a Viewer', () => {
  it('decides every call as the check decides it for a credential cut to reading, as Auto’s cloud cuts a person’s credential by their role today', async () => {
    const asking = callsOf([...persons.map((caller) => cutToReading(caller)), ...keysPlaybooksAndTheLocalDeveloper]);

    const { today, reported, asked, logged } = await askedInReportOnly(
      asking,
      decisionPointOver(viewerRoleForEveryPerson),
    );

    expect(asking.length).toBe(12 * (5 * 2 * 4 + 3 * 3));
    expect(reported).toEqual(today);
    expect(countedByReason(today)).toEqual({
      succeeded: 86,
      'rejected invalid_input': 59,
      'rejected forbidden': 443,
    });
    expect(asked).toBe(asking.length);
    expect(logged).toEqual([loadedMessage]);
  });

  it('refuses a viewer whose credential grants every permission exactly what the check refuses that credential cut to reading, so the role alone keeps a viewer to reading', async () => {
    const asking = callsOf([
      ...personsGrantedEverything.map((caller) => cutToReading(caller)),
      ...keysPlaybooksAndTheLocalDeveloper,
    ]);
    const uncut = decidingOnAnUncutGrant(decisionPointOver(viewerRoleForEveryPerson));

    const { reported, today, asked, logged } = await askedInReportOnly(asking, uncut);

    expect(reported).toEqual(today);
    expect(asked).toBe(asking.length);
    expect(logged).toEqual([loadedMessage]);
  });
});
