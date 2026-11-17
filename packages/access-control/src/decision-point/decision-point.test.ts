import {
  type AccessRequest,
  allPermissions,
  type ArrivedVia,
  type CallerIdentity,
  type Outcome,
  type Permission,
  type PolicyDecisionPoint,
  type PrincipalReference,
} from '@on.auto/operations';
import { Effect } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { decidedFailingClosed } from '../engine/cedar-decisions.ts';
import { cedarModuleBundled } from '../engine/cedar-module-bundled.ts';
import { cedarCallOf } from '../engine/cedar-request.ts';
import { cedarOf } from '../engine/cedar.ts';
import { preparedPolicies, type PreparedPolicies } from '../engine/prepared-policies.ts';
import { accessSchemaFile, builtInPoliciesFile } from '../files/access-control-files.ts';
import { assignRole } from '../operations/assign-role.ts';
import { roleAssignmentsRecordedIn } from '../roles/recorded-role-assignments.ts';
import { editorRoleForEveryPerson, type RoleAssignments } from '../roles/role-assignments.ts';
import { accessSchemaOf } from '../schema/access-schema.ts';
import {
  builtIn,
  cedarOnDisk,
  createPlaybook,
  decidedBy,
  filesOnDisk,
  getDefinition,
  listConnections,
  requestOf,
  runDefinition,
  type TestOperation,
} from '../testing/access-testing.ts';
import { pinnedTableBehaviour } from '../testing/pinned-table-behaviour.ts';
import {
  askedInReportOnly,
  calls,
  callsOf,
  countedByReason,
  decidedInstead,
  decisionPointOver,
  keysPlaybooksAndTheLocalDeveloper,
  person,
} from '../testing/report-only-agreement-calls.ts';
import { ada, roleAssignmentCalls } from '../testing/role-assignment-calls.ts';
import { cedarDecisionPoint, loadedMessage } from './cedar-decision-point.ts';

const moduleOfABundle = cedarModuleBundled(async () => ({ default: await cedarOnDisk() }));

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

const runs: TestOperation = { ...runDefinition, permissions: ['playbook:write', 'playbook:run'] };

const changes: TestOperation = { ...runDefinition, name: 'update_definition' };

const operators =
  '@id("operator")\npermit (principal in Role::"operator", action in [Action::"org:read", Action::"playbook:read", Action::"playbook:run"], resource);';

const ready: { prepared?: PreparedPolicies } = {};

function askedAs(role: string, operation: TestOperation): string {
  const { prepared } = ready;
  const { decision, determiningPolicies } = decidedFailingClosed(() => {
    if (prepared === undefined) {
      throw new Error('The policies are not ready');
    }
    return prepared.cedar.statefulIsAuthorized({
      ...cedarCallOf(
        requestOf({
          principal: { type: 'person', id: 'ada' },
          operation,
          resource: { type: 'playbook', id: 'alpha', org: 'acme' },
        }),
        [builtIn(role, { type: 'org', id: 'acme' })],
      ),
      preparsedSchemaName: prepared.schemaName,
      preparsedPolicySetId: prepared.policySetId,
      validateRequest: true,
    });
  });
  return `${decision} by ${determiningPolicies.join(', ')}`;
}

const acme = { type: 'org', id: 'acme' } as const;

const alpha = { type: 'playbook', id: 'alpha', org: 'acme' } as const;

const keyAndLocalDeveloper: readonly (readonly [PrincipalReference, ArrivedVia])[] = [
  [{ type: 'key', id: 'ci-key' }, 'key'],
  [{ type: 'local_developer', id: 'local' }, 'local'],
];

const asked = [
  [listConnections, acme],
  [createPlaybook, acme],
  [getDefinition, alpha],
  [runDefinition, alpha],
] as const;

const reading: readonly Permission[] = ['org:read', 'playbook:read'];

function cutToReadingReportOnlyAgreement(caller: CallerIdentity): CallerIdentity {
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

pinnedTableBehaviour('the engine Node loads', (parts) =>
  cedarDecisionPoint({ module: cedarOnDisk, files: filesOnDisk, ...parts }),
);

pinnedTableBehaviour('the engine a bundle hands over compiled, as a Worker loads it', (parts) =>
  cedarDecisionPoint({ module: moduleOfABundle, files: filesOnDisk, ...parts }),
);

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

describe('operator', () => {
  beforeAll(async () => {
    const cedar = cedarOf(await cedarOnDisk());
    ready.prepared = preparedPolicies(cedar, {
      schema: accessSchemaOf(
        await filesOnDisk.text(accessSchemaFile),
        [...allPermissions, 'playbook:run'],
        [runs, changes, getDefinition],
      ),
      policies: `${await filesOnDisk.text(builtInPoliciesFile)}\n${operators}`,
    });
  });

  describe('a level that runs and answers but cannot change', () => {
    it('is one more policy and one more permission, declared beside write by the operations that run, with no change to the question', () => {
      expect([askedAs('operator', runs), askedAs('operator', getDefinition), askedAs('operator', changes)]).toEqual([
        'allow by operator',
        'allow by operator',
        'deny by ',
      ]);
      expect([askedAs('editor', runs), askedAs('viewer', runs)]).toEqual(['allow by editor', 'deny by ']);
    });
  });
});

describe('the decision point over the read model of role assignments', () => {
  it('decides each person by the role recorded for them, and a signed-in person with no role is allowed nothing', async () => {
    const { imported, call, ledger } = roleAssignmentCalls();
    await imported(['user_ada', 'admin'], ['user_priya', 'editor']);
    await call(assignRole, ada, { person: 'user_priya', role: 'viewer' });
    const decide = decidedBy(roleAssignmentsRecordedIn(ledger.service));

    const decided = await Promise.all(
      ['user_ada', 'user_priya', 'user_dana'].map((id) =>
        Promise.all(
          asked.map(async ([operation, resource]) => {
            const { decision } = await decide(requestOf({ principal: { type: 'person', id }, operation, resource }));
            return decision;
          }),
        ),
      ),
    );

    expect(decided).toEqual([
      ['allow', 'allow', 'allow', 'allow'],
      ['allow', 'deny', 'allow', 'deny'],
      ['deny', 'deny', 'deny', 'deny'],
    ]);
  });

  it('leaves a key and the local developer as they are, bounded by their grant alone, as a runtime in local mode is', async () => {
    const { ledger } = roleAssignmentCalls();
    const decide = decidedBy(roleAssignmentsRecordedIn(ledger.service));

    const decided = await Promise.all(
      keyAndLocalDeveloper.map(([principal, via]) =>
        Promise.all(
          asked.map(async ([operation, resource]) => {
            const { decision } = await decide(requestOf({ principal, operation, resource, via }));
            return decision;
          }),
        ),
      ),
    );

    expect(decided).toEqual([
      ['allow', 'allow', 'allow', 'allow'],
      ['allow', 'allow', 'allow', 'allow'],
    ]);
  });
});

describe('the decision point in report-only mode, with the built-in policies and every person taken as an Editor', () => {
  it('decides every call as the check that decides it today, so the dispatcher logs no difference and answers as it did', async () => {
    const {
      today,
      reported,
      asked: askedReportOnlyAgreement,
      logged,
    } = await askedInReportOnly(calls, decisionPointOver(editorRoleForEveryPerson));

    expect(calls.length).toBe(11 * (5 * 2 * 4 + 3 * 3));
    expect(reported).toEqual(today);
    expect(countedByReason(today)).toEqual({
      succeeded: 89,
      'rejected invalid_input': 61,
      'rejected forbidden': 389,
    });
    expect(askedReportOnlyAgreement).toBe(calls.length);
    expect(logged).toEqual([loadedMessage]);
  });
});

describe('the decision point in report-only mode, with every person taken as a Viewer', () => {
  it('decides every call as the check decides it for a credential cut to reading, as Auto’s cloud cuts a person’s credential by their role today', async () => {
    const asking = callsOf([
      ...persons.map((caller) => cutToReadingReportOnlyAgreement(caller)),
      ...keysPlaybooksAndTheLocalDeveloper,
    ]);

    const {
      today,
      reported,
      asked: askedReportOnlyAgreement,
      logged,
    } = await askedInReportOnly(asking, decisionPointOver(viewerRoleForEveryPerson));

    expect(asking.length).toBe(12 * (5 * 2 * 4 + 3 * 3));
    expect(reported).toEqual(today);
    expect(countedByReason(today)).toEqual({
      succeeded: 86,
      'rejected invalid_input': 59,
      'rejected forbidden': 443,
    });
    expect(askedReportOnlyAgreement).toBe(asking.length);
    expect(logged).toEqual([loadedMessage]);
  });

  it('refuses a viewer whose credential grants every permission exactly what the check refuses that credential cut to reading, so the role alone keeps a viewer to reading', async () => {
    const asking = callsOf([
      ...personsGrantedEverything.map((caller) => cutToReadingReportOnlyAgreement(caller)),
      ...keysPlaybooksAndTheLocalDeveloper,
    ]);
    const uncut = decidingOnAnUncutGrant(decisionPointOver(viewerRoleForEveryPerson));

    const { reported, today, asked: askedReportOnlyAgreement, logged } = await askedInReportOnly(asking, uncut);

    expect(reported).toEqual(today);
    expect(askedReportOnlyAgreement).toBe(asking.length);
    expect(logged).toEqual([loadedMessage]);
  });
});
