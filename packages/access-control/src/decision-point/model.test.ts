import {
  allPermissions,
  type AccessDecision,
  type AccessRequest,
  type ArrivedVia,
  type Permission,
  type PrincipalReference,
  type ResourceReference,
} from '@on.auto/operations';
import { shippedFilesInMemory } from '@on.auto/shipped-files/testing';
import { Effect } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { accessSchemaFile, builtInPoliciesFile } from '../files/access-control-files.ts';
import type { RoleAssignments, ScopeReference } from '../roles/role-assignments.ts';
import {
  builtIn,
  cedarOnDisk,
  createPlaybook,
  decidedBy,
  declaredOperations,
  filesOnDisk,
  getDefinition,
  joinTheOrg,
  requestOf,
  rolesHeld,
  runDefinition,
  setConnectionModel,
  type TestOperation,
} from '../testing/access-testing.ts';
import { cedarDecisionPoint } from './cedar-decision-point.ts';

const texts = { schema: '', policies: '' };

beforeAll(async () => {
  texts.schema = await filesOnDisk.text(accessSchemaFile);
  texts.policies = await filesOnDisk.text(builtInPoliciesFile);
});

const acme: ScopeReference = { type: 'org', id: 'acme' };

const ada: PrincipalReference = { type: 'person', id: 'ada' };

const theOrg: ResourceReference = { type: 'org', id: 'acme' };

function inAlpha(definition: string): ResourceReference {
  return { type: 'definition', id: definition, playbook: 'alpha', org: 'acme' };
}

function playbook(id: string): ResourceReference {
  return { type: 'playbook', id, org: 'acme' };
}

const onlyAdminsUndoNothing =
  '@id("only-admins-undo-nothing")\nforbid (principal, action, resource) when { context.operation.irreversible } unless { principal in Role::"admin" };';

function answered(
  decide: (request: AccessRequest) => Promise<AccessDecision>,
): (request: AccessRequest) => Promise<string> {
  return async (request) => {
    const { decision, determiningPolicies } = await decide(request);
    return `${decision} by ${determiningPolicies.join(', ')}`;
  };
}

function withPolicy(policy: string, roles: RoleAssignments): (request: AccessRequest) => Promise<string> {
  const decisionPoint = cedarDecisionPoint({
    module: cedarOnDisk,
    files: shippedFilesInMemory({
      '@on.auto/access-control': {
        [accessSchemaFile.path]: texts.schema,
        [builtInPoliciesFile.path]: `${texts.policies}\n${policy}`,
      },
    }),
    operations: declaredOperations,
    roles,
  });
  return answered((request) => Effect.runPromise(decisionPoint.decide(request)));
}

function asAdaHolding(
  roles: RoleAssignments,
): (operation: TestOperation, resource: ResourceReference) => Promise<string> {
  const decide = answered(decidedBy(roles));
  return (operation, resource) => decide(requestOf({ principal: ada, operation, resource }));
}

function retiringAs(id: string, irreversible: boolean): Promise<string> {
  const decide = withPolicy(
    onlyAdminsUndoNothing,
    rolesHeld({ ada: [builtIn('editor', acme)], grace: [builtIn('admin', acme)] }),
  );
  return decide(
    requestOf({
      principal: { type: 'person', id },
      operation: runDefinition,
      resource: playbook('alpha'),
      irreversible,
    }),
  );
}

describe('a built-in role held at one playbook or one definition, with the policies as shipped and no change to the question', () => {
  it('lets a Viewer of the org made Editor of one playbook change that playbook and what is in it, and nothing else', async () => {
    const asked = asAdaHolding(
      rolesHeld({ ada: [builtIn('viewer', acme), builtIn('editor', { type: 'playbook', id: 'alpha' })] }),
    );

    expect(
      await Promise.all([
        asked(runDefinition, playbook('alpha')),
        asked(runDefinition, inAlpha('d-02')),
        asked(runDefinition, playbook('beta')),
        asked(createPlaybook, theOrg),
        asked(getDefinition, playbook('beta')),
      ]),
    ).toEqual(['allow by editor', 'allow by editor', 'deny by ', 'deny by ', 'allow by viewer']);
  });

  it('lets an Editor of one definition inside a playbook change that definition alone', async () => {
    const asked = asAdaHolding(rolesHeld({ ada: [builtIn('editor', { type: 'definition', id: 'd-02' })] }));

    expect(
      await Promise.all([
        asked(runDefinition, inAlpha('d-02')),
        asked(runDefinition, inAlpha('d-03')),
        asked(runDefinition, playbook('alpha')),
      ]),
    ).toEqual(['allow by editor', 'deny by ', 'deny by ']);
  });
});

describe('the model, extended by one more policy and no change to the question', () => {
  it('keeps everyone but an Admin from what cannot be undone with one forbid on what an operation declares', async () => {
    expect(await Promise.all([retiringAs('ada', true), retiringAs('grace', true), retiringAs('ada', false)])).toEqual([
      'deny by only-admins-undo-nothing',
      'allow by admin',
      'allow by editor',
    ]);
  });
});

const grace: PrincipalReference = { type: 'person', id: 'grace' };

function managingAs(principal: PrincipalReference, via: ArrivedVia, permissionsManagement: boolean): Promise<string> {
  const decide = answered(decidedBy(rolesHeld({ ada: [builtIn('editor', acme)], grace: [builtIn('admin', acme)] })));
  return decide(requestOf({ principal, operation: createPlaybook, resource: theOrg, via, permissionsManagement }));
}

describe('what manages permissions, with the policies as shipped', () => {
  it('is done by an Admin signed in to Studio alone, by one forbid on what an operation declares, however else the call arrives', async () => {
    expect(
      await Promise.all([
        managingAs(grace, 'studio', true),
        managingAs(grace, 'agent', true),
        managingAs(grace, 'conversation', true),
        managingAs(grace, 'run', true),
        managingAs(ada, 'studio', true),
        managingAs({ type: 'key', id: 'ci-key' }, 'key', true),
        managingAs({ type: 'local_developer', id: 'local' }, 'local', true),
        managingAs(ada, 'studio', false),
      ]),
    ).toEqual([
      'allow by admin',
      'deny by permissions-managed-by-admins-in-studio',
      'deny by permissions-managed-by-admins-in-studio',
      'deny by permissions-managed-by-admins-in-studio',
      'deny by permissions-managed-by-admins-in-studio',
      'deny by permissions-managed-by-admins-in-studio',
      'deny by permissions-managed-by-admins-in-studio',
      'allow by editor',
    ]);
  });
});

async function managingConnectionsAs(
  principal: PrincipalReference,
  via: ArrivedVia,
  operation: TestOperation,
): Promise<string> {
  const decide = decidedBy(
    rolesHeld({ ada: [builtIn('editor', acme)], grace: [builtIn('admin', acme)], ida: [builtIn('viewer', acme)] }),
  );
  const { decision, determiningPolicies } = await decide(requestOf({ principal, operation, resource: theOrg, via }));
  return `${decision} by ${determiningPolicies.toSorted().join(', ')}`;
}

const ida: PrincipalReference = { type: 'person', id: 'ida' };

describe('what manages connections, with the policies as shipped', () => {
  it.each([
    ['an Admin in Studio', grace, 'studio', 'allow by admin'],
    ['an Admin through their agent', grace, 'agent', 'allow by admin'],
    ['an Admin asking Auto in a conversation', grace, 'conversation', 'allow by admin'],
    ['an Admin in a run they started', grace, 'run', 'allow by admin, run-as-started'],
    ['an Editor in Studio', ada, 'studio', 'deny by connections-managed-by-admins'],
    ['an Editor through their agent', ada, 'agent', 'deny by connections-managed-by-admins'],
    ['an Editor in a run they started', ada, 'run', 'deny by connections-managed-by-admins'],
    ['a Viewer in Studio', ida, 'studio', 'deny by connections-managed-by-admins'],
    ['a key', { type: 'key', id: 'ci-key' }, 'key', 'allow by key'],
    ['the local developer', { type: 'local_developer', id: 'local' }, 'local', 'allow by local-developer'],
  ] as const)(
    'is decided for %s by one forbid on what the operation declares',
    async (_caller, principal, via, decided) => {
      expect(await managingConnectionsAs(principal, via, setConnectionModel)).toBe(decided);
    },
  );

  it('leaves an Editor what does not declare it', async () => {
    expect(await managingConnectionsAs(ada, 'studio', createPlaybook)).toBe('allow by editor');
  });
});

const linus: PrincipalReference = { type: 'person', id: 'linus' };

function joiningAs(principal: PrincipalReference, via: ArrivedVia, operation: TestOperation): Promise<string> {
  const decide = answered(decidedBy(rolesHeld({ ada: [builtIn('editor', acme)] })));
  return decide(requestOf({ principal, operation, resource: theOrg, via }));
}

describe('an operation by which a person joins the org by its enrolment, with the policies as shipped', () => {
  it('is let through for a person who holds no role yet, signed in to Studio alone, and nothing else is', async () => {
    expect(
      await Promise.all([
        joiningAs(linus, 'studio', joinTheOrg),
        joiningAs(linus, 'agent', joinTheOrg),
        joiningAs(linus, 'conversation', joinTheOrg),
        joiningAs(linus, 'studio', createPlaybook),
      ]),
    ).toEqual(['allow by enrolment', 'deny by ', 'deny by ', 'deny by ']);
    expect(await joiningAs(ada, 'studio', joinTheOrg)).toMatch(/^allow by /u);
  });
});

const viewerAdaEditorGrace = decidedBy(rolesHeld({ ada: [builtIn('viewer', acme)], grace: [builtIn('editor', acme)] }));

function askedAtTheOrg(
  principal: PrincipalReference,
  operation: TestOperation,
  permissions: readonly Permission[] = allPermissions,
): Promise<string> {
  return answered(viewerAdaEditorGrace)(requestOf({ principal, operation, resource: theOrg, permissions }));
}

describe('an operation of a playbook asked at the org, as a listing of tools asks before the call names its playbook', () => {
  it('is decided by the roles held at the org and the permissions of the grant', async () => {
    expect(
      await Promise.all([
        askedAtTheOrg(ada, getDefinition),
        askedAtTheOrg(ada, runDefinition),
        askedAtTheOrg(grace, runDefinition),
        askedAtTheOrg(grace, runDefinition, ['org:read', 'playbook:read']),
        askedAtTheOrg({ type: 'person', id: 'nobody' }, getDefinition),
      ]),
    ).toEqual(['allow by viewer', 'deny by ', 'allow by editor', 'deny by within-granted-permissions', 'deny by ']);
  });
});
