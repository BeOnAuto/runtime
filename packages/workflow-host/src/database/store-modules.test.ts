import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

const sources = fileURLToPath(new URL('..', import.meta.url));

const drivers: ReadonlySet<string> = new Set([
  '@event-driven-io/emmett-sqlite/sqlite3',
  '@on.auto/ledger/sqlite3',
  '@on.auto/ledger/postgresql',
  'pg',
  'sqlite3',
]);

function driversReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => drivers.has(name));
}

describe('the module of the database of each store', () => {
  it('is reached from neither entry of the host, and loads when the host first opens a database on its store', () => {
    expect([...driversReachedFrom('index.ts'), ...driversReachedFrom('testing/index.ts')]).toEqual([]);
    expect(driversReachedFrom('database/sqlite-database.ts')).toEqual(['@event-driven-io/emmett-sqlite/sqlite3']);
    expect(driversReachedFrom('database/postgresql-database.ts')).toEqual(['@on.auto/ledger/postgresql']);
  });
});
