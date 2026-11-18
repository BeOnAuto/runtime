import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import {
  checkedProjection,
  type KeptProjection,
  Ledger,
  type ProjectedRowsQuery,
  streamPrefixOfOrg,
} from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, ManagedRuntime, Result, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { type BuiltInRoleId, builtInRoleIds } from '../roles/built-in-roles.ts';
import { type RoleAssignmentCommand, roleAssignmentDecider } from './role-assignment-decider.ts';
import {
  type AssignedPrincipal,
  type AssignmentScope,
  identityServiceKeyOfRole,
  principalKeyOf,
  type RecordedRoleAssignmentEvent,
  RoleAssignmentEventSchema,
  roleAssignmentsStreamOf,
  roleOfIdentityServiceKey,
} from './role-assignment-facts.ts';
import { roleAssignmentRows, roleAssignmentsName } from './role-assignment-rows.ts';

const acted = { at: '2026-11-14T15:20:00.000Z', by: 'person:user_2ada' };

const priya = { type: 'person', id: 'user_7kLm2' } as const;

const acme = { type: 'org', id: 'acme' } as const;

const baseline: readonly RecordedRoleAssignmentEvent[] = [
  {
    type: 'role_unassigned',
    data: { principal: priya, role: { type: 'built_in', id: 'editor' }, scope: acme, source: 'manual' },
    context: acted,
  },
  {
    type: 'role_assigned',
    data: { principal: priya, role: { type: 'built_in', id: 'viewer' }, scope: acme, source: 'manual' },
    context: acted,
  },
];

const firstAdmin: readonly RecordedRoleAssignmentEvent[] = [
  {
    type: 'role_assigned',
    data: { principal: priya, role: { type: 'built_in', id: 'admin' }, scope: acme, source: 'bootstrap' },
    context: { at: acted.at, by: `person:${priya.id}` },
  },
];

const decoded = Schema.decodeUnknownResult(RoleAssignmentEventSchema);

type Changed = Readonly<Record<string, unknown>>;

function readWith(data: Changed): boolean {
  return Result.isSuccess(
    decoded({
      type: 'role_assigned',
      data: { principal: priya, role: { type: 'built_in', id: 'viewer' }, scope: acme, source: 'import', ...data },
      context: acted,
    }),
  );
}

const read: readonly Changed[] = [
  {},
  { scope: { type: 'playbook', id: 'month-end' } },
  { source: 'invitation' },
  { source: 'enrolment' },
  { source: 'command' },
  { source: 'identity_service' },
  { source: 'bootstrap' },
];

const refused: readonly Changed[] = [
  { principal: { type: 'key', id: 'ci' } },
  { principal: { type: 'person', id: '' } },
  { principal: { type: 'person', id: 'u'.repeat(257) } },
  { principal: { type: 'person', id: 'user_\u0000' } },
  { role: { type: 'built_in', id: 'member' } },
  { role: { type: 'built_in', id: 'org:admin' } },
  { role: { type: 'custom', id: 'auditor' } },
  { scope: undefined },
  { scope: { type: 'org', id: 'a/b' } },
  { scope: { type: 'playbook', id: 'Month End' } },
  { scope: { type: 'definition', id: 'close' } },
  { source: 'guessed' },
];

function roleOfKey(key: string): BuiltInRoleId {
  const role = roleOfIdentityServiceKey.get(key);
  if (role === undefined) {
    throw new Error(`The table names no role of ${key}`);
  }
  return role;
}

const acmeRoleAssignmentFill: AssignmentScope = { type: 'org', id: 'acme' };

const stream = `${streamPrefixOfOrg({ org: 'acme' })}${roleAssignmentsStreamOf(acmeRoleAssignmentFill)}`;

const people = ['user_ada', 'user_priya', 'user_dana', 'user_lee'];

const commands: readonly RoleAssignmentCommand[] = [
  {
    kind: 'provision',
    source: 'import',
    scope: acmeRoleAssignmentFill,
    assignments: people.map((id, at) => ({
      principal: { type: 'person', id },
      role: { type: 'built_in', id: at === 0 ? 'admin' : 'editor' },
    })),
    at: '2026-11-14T09:00:00.000Z',
    by: 'runtime',
  },
  {
    kind: 'assign',
    actor: { type: 'person', id: 'user_ada' },
    principal: { type: 'person', id: 'user_priya' },
    role: { type: 'built_in', id: 'viewer' },
    scope: acmeRoleAssignmentFill,
    at: '2026-11-14T10:00:00.000Z',
    by: 'person:user_ada',
  },
  {
    kind: 'unassign',
    actor: { type: 'person', id: 'user_ada' },
    principal: { type: 'person', id: 'user_lee' },
    role: { type: 'built_in', id: 'editor' },
    scope: acmeRoleAssignmentFill,
    at: '2026-11-14T11:00:00.000Z',
    by: 'person:user_ada',
  },
];

function aDatabase(): string {
  const folder = mkdtempSync(join(tmpdir(), 'role-assignments-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return join(folder, 'ledger.sqlite');
}

async function onLedger<A>(
  fileName: string,
  projections: readonly KeptProjection[],
  use: (ledger: Ledger['Service']) => Effect.Effect<A, unknown>,
): Promise<A> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName, projections }));
  try {
    return await runtime.runPromise(Effect.flatMap(Effect.service(Ledger), use));
  } finally {
    await runtime.dispose();
  }
}

const recorded = (ledger: Ledger['Service']) =>
  Effect.forEach(commands, (command) => ledger.execute(stream, roleAssignmentDecider, command));

const rowsOf = (ledger: Ledger['Service']) =>
  ledger.readProjectedRows(roleAssignmentsName, { org: 'acme' }, { where: [], orderBy: [], order: 'asc', limit: 10 });

const acmeRoleAssignmentRows: AssignmentScope = { type: 'org', id: 'acme' };

const ada: AssignedPrincipal = { type: 'person', id: 'user_ada' };

const priyaRoleAssignmentRows: AssignedPrincipal = { type: 'person', id: 'user_priya' };

const every: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 10 };

const imported: RoleAssignmentCommand = {
  kind: 'provision',
  source: 'import',
  scope: acmeRoleAssignmentRows,
  assignments: [
    { principal: ada, role: { type: 'built_in', id: 'admin' } },
    { principal: priyaRoleAssignmentRows, role: { type: 'built_in', id: 'editor' } },
  ],
  at: '2026-11-14T09:00:00.000Z',
  by: 'runtime',
};

const madeAViewer: RoleAssignmentCommand = {
  kind: 'assign',
  actor: { type: 'person', id: 'user_ada' },
  principal: priyaRoleAssignmentRows,
  role: { type: 'built_in', id: 'viewer' },
  scope: acmeRoleAssignmentRows,
  at: '2026-11-14T10:30:00.000Z',
  by: 'person:user_ada',
};

const adaAnAdmin = {
  org: 'acme',
  key: 'person:user_ada',
  child: 'org/acme/built_in/admin',
  row: {
    principal_type: 'person',
    principal_id: 'user_ada',
    role_type: 'built_in',
    role_id: 'admin',
    scope_type: 'org',
    scope_id: 'acme',
    source: 'import',
    assigned_at: '2026-11-14T09:00:00.000Z',
    assigned_by: 'runtime',
  },
};

const priyaAViewer = {
  org: 'acme',
  key: 'person:user_priya',
  child: 'org/acme/built_in/viewer',
  row: {
    principal_type: 'person',
    principal_id: 'user_priya',
    role_type: 'built_in',
    role_id: 'viewer',
    scope_type: 'org',
    scope_id: 'acme',
    source: 'manual',
    assigned_at: '2026-11-14T10:30:00.000Z',
    assigned_by: 'person:user_ada',
  },
};

function recordedIn(...commandsRoleAssignmentRows: readonly RoleAssignmentCommand[]) {
  const ledger = memoryLedger(undefined, [roleAssignmentRows]);
  const streamRoleAssignmentRows = `${streamPrefixOfOrg({ org: 'acme' })}${roleAssignmentsStreamOf(acmeRoleAssignmentRows)}`;
  return Effect.runPromise(
    Effect.forEach(commandsRoleAssignmentRows, (command) =>
      ledger.service.execute(streamRoleAssignmentRows, roleAssignmentDecider, command),
    ).pipe(Effect.andThen(ledger.service.readProjectedRows(roleAssignmentsName, { org: 'acme' }, every))),
  );
}

describe('the facts of role assignments', () => {
  recordedFactsBehaviour({
    schema: RoleAssignmentEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.57.0': baseline, '0.65.0': firstAdmin },
  });
});

describe('what a fact of a role assignment holds', () => {
  it('names a person by id, a built-in role by the runtime’s own id, the org or a playbook as the scope, always, and how it came about', () => {
    expect(read.map((data) => readWith(data))).toEqual(read.map(() => true));
  });

  it('refuses another kind of principal, a role the runtime does not ship, an unnamed or malformed scope, an unknown source, an empty or unbounded id, and a role written as the identity service’s key', () => {
    expect(refused.map((data) => readWith(data))).toEqual(refused.map(() => false));
  });
});

describe('the stream of a scope’s role assignments', () => {
  it('is a stream of the kind role-assignments named by a UUID of the scope’s type and id, so a playbook named org never meets the org', () => {
    const ofTheOrg = roleAssignmentsStreamOf(acme);

    expect(ofTheOrg).toMatch(
      /^role-assignments\/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(roleAssignmentsStreamOf(acme)).toBe(ofTheOrg);
    expect(roleAssignmentsStreamOf({ type: 'org', id: 'globex' })).not.toBe(ofTheOrg);
    expect(roleAssignmentsStreamOf({ type: 'playbook', id: 'acme' })).not.toBe(ofTheOrg);
  });

  it('keys a principal by its type and id together', () => {
    expect(principalKeyOf(priya)).toBe('person:user_7kLm2');
  });
});

describe('the identity service’s role keys, both ways', () => {
  it('give each built-in role the key the identity service marks it by, and read each key back as the role it names', () => {
    expect(builtInRoleIds.map((role) => [role, identityServiceKeyOfRole[role]])).toEqual([
      ['admin', 'org:admin'],
      ['editor', 'org:member'],
      ['viewer', 'org:member'],
    ]);
    expect([...roleOfIdentityServiceKey.keys()].map((key) => identityServiceKeyOfRole[roleOfKey(key)])).toEqual([
      'org:admin',
      'org:member',
    ]);
  });
});

describe('the read model of role assignments on SQLite', () => {
  it('is filled from the facts when a ledger that recorded them first opens with it, row for row as one kept from the start', async () => {
    const before = aDatabase();
    const kept = aDatabase();
    await onLedger(before, [], recorded);

    const filled = await onLedger(before, [roleAssignmentRows], rowsOf);
    const inline = await onLedger(kept, [roleAssignmentRows], (ledger) =>
      Effect.andThen(recorded(ledger), rowsOf(ledger)),
    );

    expect(filled).toEqual(inline);
    expect(filled.map(({ key, row }) => [key, row['role_id']])).toEqual([
      ['person:user_ada', 'admin'],
      ['person:user_dana', 'editor'],
      ['person:user_priya', 'viewer'],
    ]);
  });
});

describe('the read model of role assignments', () => {
  it('is a projection of the org’s role-assignments streams, a row for each role a principal holds and where, under the principal', () => {
    expect(checkedProjection(roleAssignmentRows)).toMatchObject({
      name: 'role_assignments',
      version: 1,
      scopes: ['org'],
      kinds: ['role-assignments'],
      types: ['role_assigned', 'role_unassigned'],
    });
  });

  it('keeps each assignment given with how, when and by whom, and drops one taken away in the same append that gives the next', async () => {
    expect(await recordedIn(imported, madeAViewer)).toEqual([adaAnAdmin, priyaAViewer]);
  });

  it('changes nothing for a role taken away that the principal does not hold there', () => {
    const message = {
      id: 'b7e1f0c2-3a4d-5e6f-8a9b-0c1d2e3f4a5b',
      position: 1,
      type: 'role_unassigned',
      data: {
        principal: priyaRoleAssignmentRows,
        role: { type: 'built_in', id: 'viewer' },
        scope: acmeRoleAssignmentRows,
        source: 'manual',
      },
      context: { at: '2026-11-14T10:30:00.000Z', by: 'person:user_ada' },
    };

    expect(roleAssignmentRows.keyOf?.(message, { kind: 'role-assignments', id: 'x' })).toBe('person:user_priya');
    expect(roleAssignmentRows.rowsAfter(new Map(), message)).toBeUndefined();
  });
});
