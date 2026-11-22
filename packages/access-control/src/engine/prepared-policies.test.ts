import type { DetailedError } from '@cedar-policy/cedar-wasm/web';
import { allPermissions } from '@on.auto/operations';
import { beforeAll, describe, expect, it } from 'vitest';

import { accessSchemaFile, builtInPoliciesFile } from '../files/access-control-files.ts';
import { accessSchemaOf } from '../schema/access-schema.ts';
import {
  builtIn,
  cedarOnDisk,
  decidedBy,
  declaredOperations,
  filesOnDisk,
  requestOf,
  rolesHeld,
} from '../testing/access-testing.ts';
import { cedarOf, type Cedar } from './cedar.ts';
import { policiesById, preparedPolicies, type PreparePolicies } from './prepared-policies.ts';

const texts = { schema: '', policies: '' };

const builtInRoles = ['admin', 'editor', 'viewer'];

let cedar: Cedar;

beforeAll(async () => {
  cedar = cedarOf(await cedarOnDisk());
  texts.schema = accessSchemaOf(await filesOnDisk.text(accessSchemaFile), allPermissions, declaredOperations);
  texts.policies = await filesOnDisk.text(builtInPoliciesFile);
});

interface Referenced {
  readonly type: string;
  readonly id: string;
}

function entitiesNamedIn(value: unknown): readonly Referenced[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => entitiesNamedIn(item));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const type: unknown = Reflect.get(value, 'type');
  const id: unknown = Reflect.get(value, 'id');
  const named = typeof type === 'string' && typeof id === 'string' ? [{ type, id }] : [];
  return [...named, ...Object.values(value).flatMap((inner: unknown) => entitiesNamedIn(inner))];
}

function namedInPolicy(policy: string): readonly Referenced[] {
  const read = cedar.policyToJson(policy);
  return read.type === 'success' ? entitiesNamedIn(read.json) : [{ type: 'unreadable', id: policy }];
}

function attributeReadOf(value: unknown): readonly string[] | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  if (Reflect.get(value, 'Var') === 'context') {
    return [];
  }
  const access: unknown = Reflect.get(value, '.');
  if (typeof access !== 'object' || access === null) {
    return undefined;
  }
  const attribute: unknown = Reflect.get(access, 'attr');
  const above = attributeReadOf(Reflect.get(access, 'left'));
  return above === undefined || typeof attribute !== 'string' ? undefined : [...above, attribute];
}

function contextReadIn(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => contextReadIn(item));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const read = attributeReadOf(value);
  if (read !== undefined) {
    return [read.join('.')];
  }
  return Object.values(value).flatMap((inner: unknown) => contextReadIn(inner));
}

function contextReadByPolicy(policy: string): readonly string[] {
  const read = cedar.policyToJson(policy);
  return read.type === 'success' ? contextReadIn(read.json) : [`unreadable: ${policy}`];
}

function typesNamed(named: readonly Referenced[]): ReadonlySet<string> {
  return new Set(named.map(({ type }) => type));
}

function idsNamed(named: readonly Referenced[], type: string): ReadonlySet<string> {
  return new Set(named.filter((entity) => entity.type === type).map(({ id }) => id));
}

function refusedFor(policies: string): () => unknown {
  return () => preparedPolicies(cedar, { ...texts, policies });
}

function failing(): { type: 'failure'; errors: DetailedError[] } {
  return { type: 'failure', errors: [{ message: 'refused', help: null, code: null, url: null, severity: null }] };
}

describe('the built-in policies', () => {
  it('pass the schema in strict mode, with no error and no warning', () => {
    const validated = cedar.validate({
      validationSettings: { mode: 'strict' },
      schema: texts.schema,
      policies: { staticPolicies: { ...policiesById(cedar, texts.policies) } },
    });

    expect(validated).toMatchObject({
      type: 'success',
      validationErrors: [],
      validationWarnings: [],
      otherWarnings: [],
    });
  });

  it('each have an id of their own, which names them in every answer', () => {
    expect(Object.keys(policiesById(cedar, texts.policies)).toSorted()).toEqual(
      [
        'viewer',
        'editor',
        'admin',
        'key',
        'local-developer',
        'playbook-itself',
        'run-as-started',
        'own-org',
        'within-granted-permissions',
        'within-granted-playbooks',
        'permissions-managed-by-admins-in-studio',
        'enrolment',
      ].toSorted(),
    );
  });

  it('name no operation, person, key, org or playbook: only built-in roles and the permissions operations declare', () => {
    const named = Object.values(policiesById(cedar, texts.policies)).flatMap((policy) => namedInPolicy(policy));

    expect(typesNamed(named)).toEqual(new Set(['Role', 'Action']));
    expect(idsNamed(named, 'Role')).toEqual(new Set(builtInRoles));
    expect(idsNamed(named, 'Action')).toEqual(new Set(allPermissions));
  });
});

describe('what the built-in policies read of a request', () => {
  it('is how it arrived, what its credential grants and, of what its operation declares about itself, only whether it targets a playbook, whether it manages permissions and whether it enrols its caller, beside the permissions its action is in', () => {
    const read = Object.values(policiesById(cedar, texts.policies)).flatMap((policy) => contextReadByPolicy(policy));

    expect(new Set(read)).toEqual(
      new Set([
        'via',
        'granted.org',
        'granted.permissions',
        'granted.all_playbooks',
        'granted.playbooks',
        'operation.targets_playbook',
        'operation.permissions_management',
        'operation.enrolment',
      ]),
    );
  });
});

describe('policies made ready for the engine', () => {
  it('are read in under names that follow from their text alone, the same for the same text and never one for each org', () => {
    const prepared = preparedPolicies(cedar, texts);
    const again = preparedPolicies(cedar, texts);
    const other = preparedPolicies(cedar, {
      ...texts,
      policies: `${texts.policies}\n@id("nothing-irreversible")\nforbid (principal, action, resource) when { context.operation.irreversible };`,
    });

    expect([again.schemaName, again.policySetId, again.policies]).toEqual([
      prepared.schemaName,
      prepared.policySetId,
      12,
    ]);
    expect(other.schemaName).toBe(prepared.schemaName);
    expect(other.policySetId).not.toBe(prepared.policySetId);
    expect(prepared.schemaName).toMatch(/^schema-[0-9a-f]{64}$/u);
    expect(prepared.policySetId).toMatch(/^policies-[0-9a-f]{64}$/u);
  });

  it('are refused where a policy has no id, an id is used twice, a template is given, or the text does not parse', () => {
    expect(refusedFor('permit (principal, action, resource);')).toThrow('A policy has no @id');
    expect(
      refusedFor('@id("a") permit (principal, action, resource);\n@id("a") forbid (principal, action, resource);'),
    ).toThrow('The policy id a is used more than once');
    expect(refusedFor('@id("t") permit (principal == ?principal, action, resource);')).toThrow(
      'The policies hold a template, which this decision point does not link',
    );
    expect(refusedFor('permit (principal, action')).toThrow('The policies do not parse');
  });
});

describe('policies the engine is not given', () => {
  it('are those that do not pass the schema in strict mode, or a schema that does not parse', () => {
    expect(refusedFor('@id("by-name") permit (principal, action, resource) when { principal.name == "Ada" };')).toThrow(
      'The policies do not pass the schema in strict mode: by-name: ',
    );
    expect(() => preparedPolicies(cedar, { ...texts, schema: 'entity Org' })).toThrow(
      'The policies could not be validated',
    );
  });

  it('are those the engine cannot read back or read in', () => {
    expect(() => preparedPolicies({ ...cedar, policyToJson: failing }, texts)).toThrow('A policy has no @id');
    expect(() => preparedPolicies({ ...cedar, preparseSchema: failing }, texts)).toThrow(
      'The schema could not be read in: refused',
    );
    expect(() => preparedPolicies({ ...cedar, preparsePolicySet: failing }, texts)).toThrow(
      'The policies could not be read in: refused',
    );
  });
});

describe('policies a decision point is given the way to prepare', () => {
  it('are the policies its files hold, prepared that way, and decide every request as the policies it prepares itself', async () => {
    const asked: string[] = [];
    const preparing: PreparePolicies = (engine, read) => {
      asked.push(read.policies);
      return preparedPolicies(engine, read);
    };
    const roles = rolesHeld({ editor: [builtIn('editor', { type: 'org', id: 'acme' })] });
    const principal: Parameters<typeof requestOf>[0]['principal'] = { type: 'person', id: 'editor' };
    const requests = [
      ...declaredOperations
        .filter(({ scope }) => scope === 'playbook')
        .map((operation) =>
          requestOf({ principal, operation, resource: { type: 'playbook', id: 'alpha', org: 'acme' } }),
        ),
      ...declaredOperations
        .filter(({ scope }) => scope === 'org')
        .map((operation) => requestOf({ principal, operation, resource: { type: 'org', id: 'acme' } })),
    ];

    const [asGiven, itself] = [decidedBy(roles, declaredOperations, preparing), decidedBy(roles)];
    const decidedAsGiven = await Promise.all(requests.map((request) => asGiven(request)));
    const decidedItself = await Promise.all(requests.map((request) => itself(request)));

    expect(asked).toEqual([texts.policies]);
    expect(
      decidedAsGiven.map(({ decision, determiningPolicies, errors }) => ({
        decision,
        determiningPolicies: determiningPolicies.toSorted(),
        errors,
      })),
    ).toEqual(
      decidedItself.map(({ decision, determiningPolicies, errors }) => ({
        decision,
        determiningPolicies: determiningPolicies.toSorted(),
        errors,
      })),
    );
    expect(decidedItself.map(({ decision }) => decision)).toContain('allow');
  });
});
