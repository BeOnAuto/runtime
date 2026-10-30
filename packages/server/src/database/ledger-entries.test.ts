import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

const sources = fileURLToPath(new URL('..', import.meta.url));

const drivers: ReadonlySet<string> = new Set([
  '@on.auto/ledger/sqlite3',
  '@on.auto/ledger/postgresql',
  'pg',
  'sqlite3',
]);

function driversReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => drivers.has(name));
}

describe('the entries of the ledger the composition imports', () => {
  it('are the one of the store the settings chose, each behind the database of its store, which the composition imports as it starts', () => {
    expect(driversReachedFrom('composition/composition-root.ts')).toEqual([]);
    expect(driversReachedFrom('database/sqlite-ledger-database.ts')).toEqual(['@on.auto/ledger/sqlite3']);
    expect(driversReachedFrom('database/postgresql-ledger-database.ts')).toEqual(['@on.auto/ledger/postgresql', 'pg']);
  });
});
