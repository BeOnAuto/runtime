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
  declaredOperations,
  decidedBy,
  filesOnDisk,
  getDefinition,
  requestOf,
  rolesHeld,
  runDefinition,
} from '../testing/access-testing.ts';
import { cedarDecisionPoint, loadedMessage, unloadedMessage, unreadRoles } from './cedar-decision-point.ts';

const acme: ScopeReference = { type: 'org', id: 'acme' };

const alpha: ResourceReference = { type: 'playbook', id: 'alpha', org: 'acme' };

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
      Effect.all(
        [1, 2, 3].map(() => decisionPoint.decide(readingAlpha)),
        { concurrency: 'unbounded' },
      ).pipe(Effect.provide(logs.layer)),
    );

    expect(loads.count - loadsBefore).toBe(1);
    expect(logs.logged()).toEqual([
      {
        message: loadedMessage,
        level: 'INFO',
        annotations: { engine: 'Cedar 4.14.0', policies: 9, operations: declaredOperations.length },
      },
    ]);
  });
});

describe('a request the policy decision point cannot decide', () => {
  it('is denied, naming why, where the schema refuses it, as an operation the release does not declare', async () => {
    const decided = await decidedBy(editorRoleForEveryPerson)(
      requestOf({
        principal: { type: 'person', id: 'ada' },
        operation: { ...getDefinition, name: 'not_declared' },
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
      Effect.all([decisionPoint.decide(readingAlpha), decisionPoint.decide(readingAlpha)]).pipe(
        Effect.provide(logs.layer),
      ),
    );

    expect(decided).toEqual(
      [1, 2].map(() => ({ decision: 'deny', determiningPolicies: [], errors: ['the engine is not where it was put'] })),
    );
    expect(logs.logged()).toEqual([
      { message: unloadedMessage, level: 'ERROR', annotations: { because: 'the engine is not where it was put' } },
    ]);
  });

  it('denies every request while its policies do not pass the schema in strict mode', async () => {
    const files = shippedFilesInMemory({
      '@on.auto/access-control': {
        [accessSchemaFile.path]: await filesOnDisk.text(accessSchemaFile),
        [builtInPoliciesFile.path]:
          '@id("by-name") permit (principal, action, resource) when { principal.name == "Ada" };',
      },
    });
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
