import type { AccessDecision, ResourceReference } from '@on.auto/operations';
import { capturedLogs } from '@on.auto/operations/testing';
import { shippedFilesInMemory } from '@on.auto/shipped-files/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { accessSchemaFile, builtInPoliciesFile } from '../files/access-control-files.ts';
import { editorRoleForEveryPerson, type RoleAssignments, type ScopeReference } from '../roles/role-assignments.ts';
import {
  builtIn,
  cedarOnDisk,
  countingReads,
  declaredOperations,
  decidedBy,
  filesOnDisk,
  getDefinition,
  requestOf,
  rolesHeld,
  runDefinition,
} from '../testing/access-testing.ts';
import {
  cedarDecisionPoint,
  cedarDecisionPointLoaded,
  loadedMessage,
  unloadedMessage,
  unreadRoles,
} from './cedar-decision-point.ts';

const acme: ScopeReference = { type: 'org', id: 'acme' };

const alpha: ResourceReference = { type: 'playbook', id: 'alpha', org: 'acme' };

const theOrg: ResourceReference = { type: 'org', id: 'acme' };

const elsewhere: ResourceReference = { type: 'playbook', id: 'alpha', org: 'globex' };

const notDeclared = { ...getDefinition, name: 'not_declared' };

const people = rolesHeld({
  admin: [builtIn('admin', acme)],
  editor: [builtIn('editor', acme)],
  viewer: [builtIn('viewer', acme)],
});

const readingAlpha = requestOf({
  principal: { type: 'person', id: 'viewer' },
  operation: getDefinition,
  resource: alpha,
});

const loads = { count: 0 };

function countedLoad(): Promise<WebAssembly.Module> {
  loads.count += 1;
  return cedarOnDisk();
}

function misplacedEngine(): Promise<WebAssembly.Module> {
  return Promise.reject(new Error('the engine is not where it was put'));
}

const saidOnceLoaded = {
  message: loadedMessage,
  level: 'INFO',
  annotations: { engine: 'Cedar 4.14.0', policies: 12, operations: declaredOperations.length },
};

async function decidedAs(id: string, operation: typeof getDefinition): Promise<string> {
  const { decision, determiningPolicies }: AccessDecision = await decidedBy(people)(
    requestOf({ principal: { type: 'person', id }, operation, resource: alpha }),
  );
  return `${decision} by ${determiningPolicies.join(', ')}`;
}

describe('the policy decision point', () => {
  it('decides by the built-in roles: an Admin and an Editor read and change, a Viewer only reads, and a person with no role does nothing', async () => {
    const asked = await Promise.all(
      ['admin', 'editor', 'viewer', 'nobody'].flatMap((id) =>
        [getDefinition, runDefinition].map((operation) => decidedAs(id, operation)),
      ),
    );

    expect(asked).toEqual([
      'allow by admin',
      'allow by admin',
      'allow by editor',
      'allow by editor',
      'allow by viewer',
      'deny by ',
      'deny by ',
      'deny by ',
    ]);
  });

  it('loads the engine and reads its policies on first use, once, however many requests it decides, and says so once', async () => {
    const decisionPoint = cedarDecisionPoint({
      module: countedLoad,
      files: filesOnDisk,
      operations: declaredOperations,
      roles: people,
    });
    const logs = capturedLogs();
    const loadsBefore = loads.count;

    await Effect.runPromise(
      Effect.all([decisionPoint.decide(readingAlpha), decisionPoint.decideBatch([readingAlpha, readingAlpha])], {
        concurrency: 'unbounded',
      }).pipe(Effect.provide(logs.layer)),
    );

    expect(loads.count - loadsBefore).toBe(1);
    expect(logs.logged()).toEqual([saidOnceLoaded]);
  });
});

const everyRoleAsksEveryOperation = ['admin', 'editor', 'viewer', 'nobody'].flatMap((id) =>
  declaredOperations.map((operation) =>
    requestOf({
      principal: { type: 'person', id },
      operation,
      resource: operation.scope === 'playbook' ? alpha : theOrg,
    }),
  ),
);

function inAnyOrder(decided: AccessDecision): AccessDecision {
  return { ...decided, determiningPolicies: decided.determiningPolicies.toSorted() };
}

const policiesThatDoNotPassTheSchema =
  '@id("by-name") permit (principal, action, resource) when { principal.name == "Ada" };';

async function filesWithThePolicies(policies: string) {
  return shippedFilesInMemory({
    '@on.auto/access-control': {
      [accessSchemaFile.path]: await filesOnDisk.text(accessSchemaFile),
      [builtInPoliciesFile.path]: policies,
    },
  });
}

describe('a policy decision point loaded before its first request', () => {
  it('loads the engine and reads its policies once, says so once as it loads, and decides every request as one loaded on its first', async () => {
    const logs = capturedLogs();
    const loadsBefore = loads.count;
    const parts = { files: filesOnDisk, operations: declaredOperations, roles: people };

    const loaded = await Effect.runPromise(
      cedarDecisionPointLoaded({ ...parts, module: countedLoad }).pipe(Effect.provide(logs.layer)),
    );
    const loggedAsItLoaded = logs.logged();
    const onFirstUse = cedarDecisionPoint({ ...parts, module: cedarOnDisk });
    const [decided, decidedOnFirstUse, decidedTogether] = await Effect.runPromise(
      Effect.all([
        Effect.forEach(everyRoleAsksEveryOperation, (request) => loaded.decide(request)),
        Effect.forEach(everyRoleAsksEveryOperation, (request) => onFirstUse.decide(request)),
        loaded.decideBatch(everyRoleAsksEveryOperation),
      ]),
    );

    expect(loads.count - loadsBefore).toBe(1);
    expect(loggedAsItLoaded).toEqual([saidOnceLoaded]);
    expect(decided.map((each) => inAnyOrder(each))).toEqual(decidedOnFirstUse.map((each) => inAnyOrder(each)));
    expect(decidedTogether.map((each) => inAnyOrder(each))).toEqual(decided.map((each) => inAnyOrder(each)));
    expect(new Set(decided.map(({ decision }) => decision))).toEqual(new Set(['allow', 'deny']));
  });

  it('fails, saying why and logging nothing, where its engine cannot be loaded or its policies do not pass the schema in strict mode', async () => {
    const logs = capturedLogs();
    const parts = { operations: declaredOperations, roles: people };

    const failures = await Effect.runPromise(
      Effect.all([
        Effect.flip(cedarDecisionPointLoaded({ ...parts, module: misplacedEngine, files: filesOnDisk })),
        Effect.flip(
          cedarDecisionPointLoaded({
            ...parts,
            module: cedarOnDisk,
            files: await filesWithThePolicies(policiesThatDoNotPassTheSchema),
          }),
        ),
      ]).pipe(Effect.provide(logs.layer)),
    );

    expect(failures[0]).toBe('the engine is not where it was put');
    expect(failures[1]).toContain('by-name');
    expect(logs.logged()).toEqual([]);
  });
});

describe('a request the policy decision point cannot decide', () => {
  it('is denied, naming why, where the schema refuses it, as an operation the release does not declare', async () => {
    const decided = await decidedBy(editorRoleForEveryPerson)(
      requestOf({
        principal: { type: 'person', id: 'ada' },
        operation: notDeclared,
        resource: alpha,
      }),
    );

    expect(decided).toMatchObject({ decision: 'deny', determiningPolicies: [] });
    expect(decided.errors.join(' ')).toContain('not_declared');
  });

  it('is denied where the roles of the principal cannot be read', async () => {
    const broken: RoleAssignments = { heldBy: () => Effect.die(new Error('the read model is closed')) };

    expect(await decidedBy(broken)(readingAlpha)).toEqual({
      decision: 'deny',
      determiningPolicies: [],
      errors: [unreadRoles],
    });
  });
});

const peopleOneUnreadable: RoleAssignments = {
  heldBy: (principal, org) =>
    principal.id === 'unreadable' ? Effect.die(new Error('the read model is closed')) : people.heldBy(principal, org),
};

const askedTogether = [
  ...everyRoleAsksEveryOperation,
  requestOf({ principal: { type: 'person', id: 'admin' }, operation: getDefinition, resource: elsewhere }),
  requestOf({ principal: { type: 'person', id: 'editor' }, operation: notDeclared, resource: alpha }),
  requestOf({ principal: { type: 'person', id: 'unreadable' }, operation: getDefinition, resource: alpha }),
];

describe('a batch the policy decision point is asked', () => {
  it('is decided request by request exactly as each request is decided alone, the roles of each principal read once in each org, and nothing decided for one whose roles cannot be read', async () => {
    const counted = countingReads(peopleOneUnreadable);
    const parts = { files: filesOnDisk, operations: declaredOperations, roles: counted.roles };
    const decisionPoint = cedarDecisionPoint({ ...parts, module: cedarOnDisk });

    const alone = await Effect.runPromise(Effect.forEach(askedTogether, (request) => decisionPoint.decide(request)));
    const readAlone = counted.reads();
    const together = await Effect.runPromise(decisionPoint.decideBatch(askedTogether));

    expect(together.map((each) => inAnyOrder(each))).toEqual(alone.map((each) => inAnyOrder(each)));
    expect([readAlone, counted.reads() - readAlone]).toEqual([askedTogether.length, 6]);
    expect(together.at(-1)).toEqual({ decision: 'deny', determiningPolicies: [], errors: [unreadRoles] });
    expect(new Set(together.map(({ decision }) => decision))).toEqual(new Set(['allow', 'deny']));
  });
});

describe('a policy decision point that cannot load', () => {
  it('denies every request once its engine cannot be loaded, and logs why once', async () => {
    const decisionPoint = cedarDecisionPoint({
      module: misplacedEngine,
      files: filesOnDisk,
      operations: declaredOperations,
      roles: editorRoleForEveryPerson,
    });
    const logs = capturedLogs();

    const decided = await Effect.runPromise(
      Effect.all([decisionPoint.decide(readingAlpha), decisionPoint.decideBatch([readingAlpha, readingAlpha])]).pipe(
        Effect.provide(logs.layer),
      ),
    );

    expect(decided.flat()).toEqual(
      [1, 2, 3].map(() => ({
        decision: 'deny',
        determiningPolicies: [],
        errors: ['the engine is not where it was put'],
      })),
    );
    expect(logs.logged()).toEqual([
      { message: unloadedMessage, level: 'ERROR', annotations: { because: 'the engine is not where it was put' } },
    ]);
  });

  it('denies every request while its policies do not pass the schema in strict mode', async () => {
    const files = await filesWithThePolicies(policiesThatDoNotPassTheSchema);
    const decisionPoint = cedarDecisionPoint({
      module: cedarOnDisk,
      files,
      operations: declaredOperations,
      roles: editorRoleForEveryPerson,
    });

    const decided = await Effect.runPromise(decisionPoint.decide(readingAlpha));

    expect(decided).toMatchObject({ decision: 'deny', determiningPolicies: [] });
    expect(decided.errors.join(' ')).toContain('The policies do not pass the schema in strict mode: by-name');
  });
});
