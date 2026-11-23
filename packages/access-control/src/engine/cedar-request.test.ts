import { allPermissions, type PrincipalReference, type ResourceReference } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import type { RoleAssignment } from '../roles/role-assignments.ts';
import { builtIn, getDefinition, listPlaybooks, requestOf } from '../testing/access-testing.ts';
import { cedarCallOf } from './cedar-request.ts';

const ada: PrincipalReference = { type: 'person', id: 'user_ada' };

const alpha: ResourceReference = { type: 'playbook', id: 'alpha', org: 'acme' };

const assignments: readonly RoleAssignment[] = [
  builtIn('viewer', { type: 'org', id: 'acme' }),
  builtIn('editor', { type: 'playbook', id: 'alpha' }),
  builtIn('editor', { type: 'definition', id: 'd-02' }),
  builtIn('editor', { type: 'playbook', id: 'beta' }),
  builtIn('editor', { type: 'org', id: 'globex' }),
  builtIn('viewer', { type: 'playbook', id: 'alpha' }),
];

function rolesAt(resource: ResourceReference): unknown {
  return cedarCallOf(requestOf({ principal: ada, operation: getDefinition, resource }), assignments).entities.at(-1)
    ?.parents;
}

function asIt(principal: PrincipalReference) {
  return cedarCallOf(requestOf({ principal, operation: getDefinition, resource: alpha, playbooks: ['alpha'] }), [
    builtIn('editor', { type: 'org', id: 'acme' }),
  ]);
}

const readingTheOrg = {
  via: 'studio',
  granted: {
    org: { __entity: { type: 'Org', id: 'acme' } },
    permissions: allPermissions.map((id) => ({
      __entity: { type: 'Action', id },
    })),
    playbooks: [],
    all_playbooks: true,
  },
  operation: {
    kind: 'query',
    targets_playbook: false,
    reads_only: false,
    reaches_outside: false,
    may_change_outside: false,
    irreversible: false,
    permissions_management: false,
    enrolment: false,
    connections_management: false,
  },
};

describe('the request the engine is asked', () => {
  it('names the principal, the operation and the org in the types of the schema, and carries the grant and what the operation declares', () => {
    expect(
      cedarCallOf(requestOf({ principal: ada, operation: listPlaybooks, resource: { type: 'org', id: 'acme' } }), [
        builtIn('viewer', { type: 'org', id: 'acme' }),
      ]),
    ).toEqual({
      principal: { type: 'Person', id: 'user_ada' },
      action: { type: 'Action', id: 'org/list_playbooks' },
      resource: { type: 'Org', id: 'acme' },
      context: readingTheOrg,
      entities: [
        { uid: { type: 'Org', id: 'acme' }, attrs: {}, parents: [] },
        { uid: { type: 'Person', id: 'user_ada' }, attrs: {}, parents: [{ type: 'Role', id: 'viewer' }] },
      ],
    });
  });

  it('places a definition in its playbook and the playbook in its org, each named within the org so two orgs never share one', () => {
    const call = cedarCallOf(
      requestOf({
        principal: ada,
        operation: getDefinition,
        resource: { type: 'definition', id: 'd-02', playbook: 'alpha', org: 'acme' },
      }),
      [],
    );

    expect([call.resource, call.entities]).toEqual([
      { type: 'Definition', id: '["acme","alpha","d-02"]' },
      [
        { uid: { type: 'Org', id: 'acme' }, attrs: {}, parents: [] },
        { uid: { type: 'Playbook', id: '["acme","alpha"]' }, attrs: {}, parents: [{ type: 'Org', id: 'acme' }] },
        {
          uid: { type: 'Definition', id: '["acme","alpha","d-02"]' },
          attrs: {},
          parents: [{ type: 'Playbook', id: '["acme","alpha"]' }],
        },
        { uid: { type: 'Person', id: 'user_ada' }, attrs: {}, parents: [] },
      ],
    ]);
  });
});

describe('the roles the request gives a person', () => {
  it('are each role held at the thing asked about or at a place it is in, once, and none held elsewhere', () => {
    const viewer = { type: 'Role', id: 'viewer' };
    const editor = { type: 'Role', id: 'editor' };

    expect(rolesAt({ type: 'org', id: 'acme' })).toEqual([viewer]);
    expect(rolesAt(alpha)).toEqual([viewer, editor]);
    expect(rolesAt({ type: 'definition', id: 'd-02', playbook: 'alpha', org: 'acme' })).toEqual([viewer, editor]);
    expect(rolesAt({ type: 'definition', id: 'd-03', playbook: 'gamma', org: 'acme' })).toEqual([viewer]);
  });
});

describe('the principals that hold no role', () => {
  it('are a key and the local developer, and a playbook acting as itself, placed in the org of its grant and limited to the playbooks it names', () => {
    const itself = asIt({ type: 'playbook', id: 'alpha' });

    expect(asIt({ type: 'key', id: 'ci-key' }).entities.at(-1)).toEqual({
      uid: { type: 'Key', id: 'ci-key' },
      attrs: {},
      parents: [],
    });
    expect(asIt({ type: 'local_developer', id: 'local' }).entities.at(-1)).toEqual({
      uid: { type: 'LocalDeveloper', id: 'local' },
      attrs: {},
      parents: [],
    });
    expect([itself.principal, itself.entities]).toEqual([
      { type: 'Playbook', id: '["acme","alpha"]' },
      [
        { uid: { type: 'Org', id: 'acme' }, attrs: {}, parents: [] },
        { uid: { type: 'Playbook', id: '["acme","alpha"]' }, attrs: {}, parents: [{ type: 'Org', id: 'acme' }] },
      ],
    ]);
    expect(itself.context['granted']).toMatchObject({
      playbooks: [{ __entity: { type: 'Playbook', id: '["acme","alpha"]' } }],
      all_playbooks: false,
    });
  });
});
