import type {
  ArrivedVia,
  Permission,
  PlaybookAccess,
  PrincipalReference,
  ResourceReference,
} from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import {
  builtIn,
  declaredOperations,
  decidedBy,
  requestOf,
  rolesHeld,
  type TestOperation,
} from '../testing/access-testing.ts';

interface CallerKind {
  readonly caller: string;
  readonly principal: PrincipalReference;
  readonly via: ArrivedVia;
  readonly org?: string;
  readonly permissions?: readonly Permission[];
  readonly playbooks?: PlaybookAccess;
}

const reading: readonly Permission[] = ['org:read', 'playbook:read'];

type Thing = readonly [string, ResourceReference];

const org: Thing = ['org', { type: 'org', id: 'acme' }];

const alpha: Thing = ['alpha', { type: 'playbook', id: 'alpha', org: 'acme' }];

const beta: Thing = ['beta', { type: 'playbook', id: 'beta', org: 'acme' }];

const definitionInAlpha: Thing = ['d-02', { type: 'definition', id: 'd-02', playbook: 'alpha', org: 'acme' }];

function thingsOf({ scope, targetsPlaybook }: TestOperation): readonly Thing[] {
  if (scope === 'playbook') {
    return [alpha, beta, definitionInAlpha];
  }
  return targetsPlaybook ? [org, alpha, beta] : [org];
}

type RoleOfAPerson = 'admin' | 'editor' | 'viewer' | 'no role';

const roles: readonly RoleOfAPerson[] = ['admin', 'editor', 'viewer', 'no role'];

function personKinds(role: RoleOfAPerson): readonly CallerKind[] {
  const principal: PrincipalReference = { type: 'person', id: role };
  const named = role === 'no role' ? 'A person with no role' : `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
  return [
    { caller: `${named}, in Studio`, principal, via: 'studio' },
    { caller: `${named}, through an agent`, principal, via: 'agent' },
    { caller: `${named}, through an agent approved to read`, principal, via: 'agent', permissions: reading },
    { caller: `${named}, asking @Auto in a conversation`, principal, via: 'conversation' },
    { caller: `${named}, in a run they started`, principal, via: 'run' },
  ];
}

const callerKinds: readonly CallerKind[] = [
  ...roles.flatMap((role) => personKinds(role)),
  { caller: 'A key', principal: { type: 'key', id: 'ci-key' }, via: 'key' },
  {
    caller: 'A key that reads playbook alpha alone',
    principal: { type: 'key', id: 'alpha-reader' },
    via: 'key',
    permissions: reading,
    playbooks: ['alpha'],
  },
  {
    caller: 'Playbook alpha, in its own run',
    principal: { type: 'playbook', id: 'alpha' },
    via: 'run',
    permissions: ['playbook:read', 'playbook:write'],
    playbooks: ['alpha'],
  },
  { caller: 'The local developer', principal: { type: 'local_developer', id: 'local' }, via: 'local' },
  {
    caller: 'An Editor of another org, in Studio',
    principal: { type: 'person', id: 'editor-of-globex' },
    via: 'studio',
    org: 'globex',
  },
];

const decide = decidedBy(
  rolesHeld({
    admin: [builtIn('admin', { type: 'org', id: 'acme' })],
    editor: [builtIn('editor', { type: 'org', id: 'acme' })],
    viewer: [builtIn('viewer', { type: 'org', id: 'acme' })],
    'editor-of-globex': [builtIn('editor', { type: 'org', id: 'globex' })],
  }),
);

async function allowedTo(kind: CallerKind): Promise<readonly string[]> {
  const allowed = await Promise.all(
    declaredOperations.map(async (operation) => {
      const decided = await Promise.all(
        thingsOf(operation).map(async ([label, resource]) => {
          const { decision } = await decide(requestOf({ ...kind, operation, resource }));
          return decision === 'allow' ? [label] : [];
        }),
      );
      const on = decided.flat();
      return on.length === 0 ? [] : [`${operation.name} on ${on.join(', ')}`];
    }),
  );
  return allowed.flat();
}

const everything = [
  'list_connections on org',
  'list_playbooks on org',
  'search_in_org on org, alpha, beta',
  'create_playbook on org',
  'set_connection_playbooks on org, alpha, beta',
  'get_definition on alpha, beta, d-02',
  'run_definition on alpha, beta, d-02',
  'make_comment on alpha, beta, d-02',
];

const reads = [
  'list_connections on org',
  'list_playbooks on org',
  'search_in_org on org, alpha, beta',
  'get_definition on alpha, beta, d-02',
  'make_comment on alpha, beta, d-02',
];

const pinned = [
  { caller: 'Admin, in Studio', allowed: everything },
  { caller: 'Admin, through an agent', allowed: everything },
  { caller: 'Admin, through an agent approved to read', allowed: reads },
  { caller: 'Admin, asking @Auto in a conversation', allowed: everything },
  { caller: 'Admin, in a run they started', allowed: everything },
  { caller: 'Editor, in Studio', allowed: everything },
  { caller: 'Editor, through an agent', allowed: everything },
  { caller: 'Editor, through an agent approved to read', allowed: reads },
  { caller: 'Editor, asking @Auto in a conversation', allowed: everything },
  { caller: 'Editor, in a run they started', allowed: everything },
  { caller: 'Viewer, in Studio', allowed: reads },
  { caller: 'Viewer, through an agent', allowed: reads },
  { caller: 'Viewer, through an agent approved to read', allowed: reads },
  { caller: 'Viewer, asking @Auto in a conversation', allowed: reads },
  { caller: 'Viewer, in a run they started', allowed: reads },
  { caller: 'A person with no role, in Studio', allowed: [] },
  { caller: 'A person with no role, through an agent', allowed: [] },
  { caller: 'A person with no role, through an agent approved to read', allowed: [] },
  { caller: 'A person with no role, asking @Auto in a conversation', allowed: [] },
  { caller: 'A person with no role, in a run they started', allowed: [] },
  { caller: 'A key', allowed: everything },
  {
    caller: 'A key that reads playbook alpha alone',
    allowed: [
      'list_connections on org',
      'list_playbooks on org',
      'search_in_org on alpha',
      'get_definition on alpha, d-02',
      'make_comment on alpha, d-02',
    ],
  },
  {
    caller: 'Playbook alpha, in its own run',
    allowed: [
      'list_playbooks on org',
      'get_definition on alpha, d-02',
      'run_definition on alpha, d-02',
      'make_comment on alpha, d-02',
    ],
  },
  { caller: 'The local developer', allowed: everything },
  { caller: 'An Editor of another org, in Studio', allowed: [] },
];

describe('what the decision point allows, for each role and each kind of caller', () => {
  it('is this table, so a change to a policy shows as a change to a row', async () => {
    const table = await Promise.all(
      callerKinds.map(async (kind) => ({ caller: kind.caller, allowed: await allowedTo(kind) })),
    );

    expect(table).toEqual(pinned);
  });
});
