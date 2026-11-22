import type {
  AccessDecision,
  AccessRequest,
  ArrivedVia,
  Permission,
  PlaybookAccess,
  PolicyDecisionPoint,
  PrincipalReference,
  ResourceReference,
} from '@on.auto/operations';
import { Array as Arr, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RoleAssignments } from '../roles/role-assignments.ts';
import type { DeclaredAction } from '../schema/access-schema.ts';
import {
  builtIn,
  countingReads,
  declaredOperations,
  requestOf,
  rolesHeld,
  type TestOperation,
} from './access-testing.ts';

interface PinnedTableParts {
  readonly operations: readonly DeclaredAction[];
  readonly roles: RoleAssignments;
}

type DecisionPointOfTheHost = (parts: PinnedTableParts) => PolicyDecisionPoint;

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

const rolesOfTheTable = rolesHeld({
  admin: [builtIn('admin', { type: 'org', id: 'acme' })],
  editor: [builtIn('editor', { type: 'org', id: 'acme' })],
  viewer: [builtIn('viewer', { type: 'org', id: 'acme' })],
  'editor-of-globex': [builtIn('editor', { type: 'org', id: 'globex' })],
});

interface AskedOfAKind {
  readonly operation: TestOperation;
  readonly label: string;
  readonly request: AccessRequest;
}

function askedOf(kind: CallerKind): readonly AskedOfAKind[] {
  return declaredOperations.flatMap((operation) =>
    thingsOf(operation).map(([label, resource]) => ({
      operation,
      label,
      request: requestOf({ ...kind, operation, resource }),
    })),
  );
}

function allowedIn(asked: readonly AskedOfAKind[], decided: readonly AccessDecision[]): readonly string[] {
  const allowed = Arr.zip(asked, decided)
    .filter(([, { decision }]: readonly [AskedOfAKind, AccessDecision]) => decision === 'allow')
    .map(([each]: readonly [AskedOfAKind, AccessDecision]) => each);
  return declaredOperations.flatMap((operation) => {
    const on = allowed.filter((each) => each.operation === operation).map(({ label }) => label);
    return on.length === 0 ? [] : [`${operation.name} on ${on.join(', ')}`];
  });
}

type Decide = (request: AccessRequest) => Promise<AccessDecision>;

async function allowedTo(decide: Decide, kind: CallerKind): Promise<readonly string[]> {
  const asked = askedOf(kind);
  return allowedIn(asked, await Promise.all(asked.map(({ request }) => decide(request))));
}

async function allowedInOneBatchTo(decisionPoint: PolicyDecisionPoint, kind: CallerKind): Promise<readonly string[]> {
  const asked = askedOf(kind);
  return allowedIn(asked, await Effect.runPromise(decisionPoint.decideBatch(asked.map(({ request }) => request))));
}

const everythingButWhatManagesOrEnrols = [
  'list_connections on org',
  'list_playbooks on org',
  'search_in_org on org, alpha, beta',
  'create_playbook on org',
  'set_connection_playbooks on org, alpha, beta',
  'get_definition on alpha, beta, d-02',
  'run_definition on alpha, beta, d-02',
  'make_comment on alpha, beta, d-02',
];

const joining = 'join_org on org';

const managingConnections = 'set_connection_model on org';

const everythingButWhatOnlyAnAdminDoes = [...everythingButWhatManagesOrEnrols, joining];

const everything = [...everythingButWhatOnlyAnAdminDoes, managingConnections];

const everythingAnAdminInStudioDoes = [
  ...everythingButWhatManagesOrEnrols,
  'assign_role on org',
  joining,
  managingConnections,
];

const reads = [
  'list_connections on org',
  'list_playbooks on org',
  'search_in_org on org, alpha, beta',
  'get_definition on alpha, beta, d-02',
  'make_comment on alpha, beta, d-02',
];

const pinned = [
  { caller: 'Admin, in Studio', allowed: everythingAnAdminInStudioDoes },
  { caller: 'Admin, through an agent', allowed: everything },
  { caller: 'Admin, through an agent approved to read', allowed: reads },
  { caller: 'Admin, asking @Auto in a conversation', allowed: everything },
  { caller: 'Admin, in a run they started', allowed: everything },
  { caller: 'Editor, in Studio', allowed: everythingButWhatOnlyAnAdminDoes },
  { caller: 'Editor, through an agent', allowed: everythingButWhatOnlyAnAdminDoes },
  { caller: 'Editor, through an agent approved to read', allowed: reads },
  { caller: 'Editor, asking @Auto in a conversation', allowed: everythingButWhatOnlyAnAdminDoes },
  { caller: 'Editor, in a run they started', allowed: everythingButWhatOnlyAnAdminDoes },
  { caller: 'Viewer, in Studio', allowed: [...reads, joining] },
  { caller: 'Viewer, through an agent', allowed: reads },
  { caller: 'Viewer, through an agent approved to read', allowed: reads },
  { caller: 'Viewer, asking @Auto in a conversation', allowed: reads },
  { caller: 'Viewer, in a run they started', allowed: everythingButWhatOnlyAnAdminDoes },
  { caller: 'A person with no role, in Studio', allowed: [joining] },
  { caller: 'A person with no role, through an agent', allowed: [] },
  { caller: 'A person with no role, through an agent approved to read', allowed: [] },
  { caller: 'A person with no role, asking @Auto in a conversation', allowed: [] },
  { caller: 'A person with no role, in a run they started', allowed: everythingButWhatOnlyAnAdminDoes },
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

export function pinnedTableBehaviour(engine: string, decisionPointOf: DecisionPointOfTheHost): void {
  describe(`what the decision point allows, for each role and each kind of caller, with ${engine}`, () => {
    it('is this table, so a change to a policy shows as a change to a row', async () => {
      const decisionPoint = decisionPointOf({ operations: declaredOperations, roles: rolesOfTheTable });
      const decide: Decide = (request) => Effect.runPromise(decisionPoint.decide(request));

      const table = await Promise.all(
        callerKinds.map(async (kind) => ({ caller: kind.caller, allowed: await allowedTo(decide, kind) })),
      );

      expect(table).toEqual(pinned);
    });

    it('is the same table where each kind of caller is asked about everything in one batch, which reads its roles once', async () => {
      const counted = countingReads(rolesOfTheTable);
      const decisionPoint = decisionPointOf({ operations: declaredOperations, roles: counted.roles });

      const table = await Promise.all(
        callerKinds.map(async (kind) => ({
          caller: kind.caller,
          allowed: await allowedInOneBatchTo(decisionPoint, kind),
        })),
      );

      expect(table).toEqual(pinned);
      expect(counted.reads()).toBe(callerKinds.length);
    });
  });
}
