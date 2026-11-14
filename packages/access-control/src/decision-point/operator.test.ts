import { allPermissions } from '@on.auto/operations';
import { beforeAll, describe, expect, it } from 'vitest';

import { decidedFailingClosed } from '../engine/cedar-decisions.ts';
import { cedarCallOf } from '../engine/cedar-request.ts';
import { cedarOf } from '../engine/cedar.ts';
import { preparedPolicies, type PreparedPolicies } from '../engine/prepared-policies.ts';
import { accessSchemaFile, builtInPoliciesFile } from '../files/access-control-files.ts';
import { accessSchemaOf } from '../schema/access-schema.ts';
import {
  builtIn,
  cedarOnDisk,
  filesOnDisk,
  getDefinition,
  requestOf,
  runDefinition,
  type TestOperation,
} from '../testing/access-testing.ts';

const runs: TestOperation = { ...runDefinition, permissions: ['playbook:write', 'playbook:run'] };

const changes: TestOperation = { ...runDefinition, name: 'update_definition' };

const operators =
  '@id("operator")\npermit (principal in Role::"operator", action in [Action::"org:read", Action::"playbook:read", Action::"playbook:run"], resource);';

const ready: { prepared?: PreparedPolicies } = {};

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
