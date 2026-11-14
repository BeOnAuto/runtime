import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Ledger, streamPrefixOfOrg, type KeptProjection } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { roleAssignmentDecider, type RoleAssignmentCommand } from './role-assignment-decider.ts';
import { roleAssignmentsStreamOf, type AssignmentScope } from './role-assignment-facts.ts';
import { roleAssignmentRows, roleAssignmentsName } from './role-assignment-rows.ts';

const acme: AssignmentScope = { type: 'org', id: 'acme' };

const stream = `${streamPrefixOfOrg({ org: 'acme' })}${roleAssignmentsStreamOf(acme)}`;

const people = ['user_ada', 'user_priya', 'user_dana', 'user_lee'];

const commands: readonly RoleAssignmentCommand[] = [
  {
    kind: 'import',
    scope: acme,
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
    scope: acme,
    at: '2026-11-14T10:00:00.000Z',
    by: 'person:user_ada',
  },
  {
    kind: 'unassign',
    actor: { type: 'person', id: 'user_ada' },
    principal: { type: 'person', id: 'user_lee' },
    role: { type: 'built_in', id: 'editor' },
    scope: acme,
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
