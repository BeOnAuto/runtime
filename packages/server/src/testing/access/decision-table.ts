import { cedarDecisionPoint, cedarModuleIn, type DeclaredAction, type RoleAssignments } from '@on.auto/access-control';
import {
  allPermissions,
  enforcedDecisionOf,
  type AccessContext,
  type AccessRequest,
  type ArrivedVia,
  type Permission,
  type PlaybookAccess,
  type PrincipalReference,
} from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Effect } from 'effect';

import { shippedRoots } from '../../server-options/shipped-roots.ts';
import { actionOf } from '../openapi/declared-operations.ts';

interface CallerKind {
  readonly caller: string;
  readonly principal: PrincipalReference;
  readonly via: ArrivedVia;
  readonly org?: string;
  readonly permissions?: readonly Permission[];
  readonly playbooks?: PlaybookAccess;
}

const reading: readonly Permission[] = ['org:read', 'playbook:read'];

type RoleOfAPerson = 'Admin' | 'Editor' | 'Viewer';

function personKinds(role: RoleOfAPerson): readonly CallerKind[] {
  const principal: PrincipalReference = { type: 'person', id: role.toLowerCase() };
  return [
    { caller: `${role}, in Studio`, principal, via: 'studio' },
    { caller: `${role}, through their connected agent`, principal, via: 'agent' },
    { caller: `${role}, asking @Auto in Slack`, principal, via: 'conversation' },
    { caller: `${role}, in a run they started`, principal, via: 'run' },
  ];
}

const callerKinds: readonly CallerKind[] = [
  ...personKinds('Admin'),
  ...personKinds('Editor'),
  {
    caller: 'Editor, through an agent they approved to read',
    principal: { type: 'person', id: 'editor' },
    via: 'agent',
    permissions: reading,
  },
  ...personKinds('Viewer'),
  { caller: 'A person with no role, in Studio', principal: { type: 'person', id: 'nobody' }, via: 'studio' },
  {
    caller: 'An Editor of another org, in Studio',
    principal: { type: 'person', id: 'editor-of-globex' },
    via: 'studio',
    org: 'globex',
  },
  { caller: 'An API key', principal: { type: 'key', id: 'ci-key' }, via: 'key' },
  { caller: 'An API key that reads', principal: { type: 'key', id: 'reader' }, via: 'key', permissions: reading },
  {
    caller: 'Playbook alpha, in a run a trigger or a schedule started',
    principal: { type: 'playbook', id: 'alpha' },
    via: 'run',
    permissions: ['playbook:read', 'playbook:write'],
    playbooks: ['alpha'],
  },
];

const heldRoles: readonly (readonly [string, string, string])[] = [
  ['admin', 'admin', 'acme'],
  ['editor', 'editor', 'acme'],
  ['viewer', 'viewer', 'acme'],
  ['editor-of-globex', 'editor', 'globex'],
];

const roles: RoleAssignments = {
  heldBy: ({ id }) =>
    Effect.succeed(
      heldRoles
        .filter(([principal]) => principal === id)
        .map(([, role, org]) => ({ role: { type: 'built_in', id: role }, scope: { type: 'org', id: org } })),
    ),
};

type Unsaid = Omit<AccessContext['operation'], 'targetsPlaybook'>;

const whatTheDocumentDoesNotSay: readonly Unsaid[] = [
  {
    kind: 'query',
    readsOnly: false,
    reachesOutside: false,
    mayChangeOutside: false,
    irreversible: false,
    permissionsManagement: false,
  },
  {
    kind: 'command',
    readsOnly: true,
    reachesOutside: true,
    mayChangeOutside: true,
    irreversible: true,
    permissionsManagement: true,
  },
];

function requestOf(kind: CallerKind, operation: DeclaredAction, unsaid: Unsaid): AccessRequest {
  return {
    principal: kind.principal,
    action: { scope: operation.scope, name: operation.name },
    resource:
      operation.scope === 'playbook' ? { type: 'playbook', id: 'alpha', org: 'acme' } : { type: 'org', id: 'acme' },
    context: {
      via: kind.via,
      granted: {
        org: kind.org ?? 'acme',
        permissions: kind.permissions ?? allPermissions,
        playbooks: kind.playbooks ?? '*',
      },
      operation: { ...unsaid, targetsPlaybook: operation.targetsPlaybook },
    },
  };
}

type Enforced = Effect.Success<ReturnType<typeof enforcedDecisionOf>>;

interface Decided {
  readonly operation: string;
  readonly allowed: boolean;
  readonly alike: boolean;
  readonly enforced: readonly Enforced[];
}

export interface DecisionRow {
  readonly caller: string;
  readonly allowed: readonly string[];
  readonly decidedOtherwise: readonly Decided[];
  readonly refusedForTheRole: readonly string[];
  readonly enforcedOtherwise: readonly Decided[];
}

function isAllowed(enforced: Enforced): boolean {
  return enforced.decision === 'allow';
}

function isRefusedForTheRole(enforced: Enforced): boolean {
  return enforced.decision === 'deny' && enforced.cause === 'role';
}

const files = shippedFilesOnDisk(shippedRoots);

async function rowOf(operations: readonly DeclaredAction[], kind: CallerKind): Promise<DecisionRow> {
  const decisionPoint = cedarDecisionPoint({ module: cedarModuleIn(files), files, operations, roles });
  const decided = await Promise.all(
    operations.map(async (operation): Promise<Decided> => {
      const allowed = await Promise.all(
        whatTheDocumentDoesNotSay.map(async (unsaid) => {
          const { decision } = await Effect.runPromise(decisionPoint.decide(requestOf(kind, operation, unsaid)));
          return decision === 'allow';
        }),
      );
      const enforced = await Promise.all(
        whatTheDocumentDoesNotSay.map((unsaid) =>
          Effect.runPromise(enforcedDecisionOf(decisionPoint, requestOf(kind, operation, unsaid))),
        ),
      );
      return {
        operation: actionOf(operation),
        allowed: allowed.every(Boolean),
        alike: new Set(allowed).size === 1,
        enforced,
      };
    }),
  );
  return {
    caller: kind.caller,
    allowed: decided.filter(({ allowed }) => allowed).map(({ operation }) => operation),
    decidedOtherwise: decided.filter(({ alike }) => !alike),
    refusedForTheRole: decided
      .filter(({ enforced }) => enforced.every((each) => isRefusedForTheRole(each)))
      .map(({ operation }) => operation),
    enforcedOtherwise: decided.filter(
      ({ allowed, enforced }) =>
        new Set(enforced.map((each) => JSON.stringify(each))).size !== 1 ||
        enforced.some((each) => isAllowed(each) !== allowed),
    ),
  };
}

export function decisionTableOf(operations: readonly DeclaredAction[]): Promise<readonly DecisionRow[]> {
  return Promise.all(callerKinds.map((kind) => rowOf(operations, kind)));
}
