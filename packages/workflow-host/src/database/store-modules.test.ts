import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

const sources = fileURLToPath(new URL('..', import.meta.url));

const drivers: ReadonlySet<string> = new Set([
  '@on.auto/ledger/sqlite3',
  '@on.auto/ledger/postgresql',
  '@on.auto/node-sqlite',
  'node:sqlite',
  'pg',
]);

function driversReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => drivers.has(name));
}

describe('the module of the database of each store', () => {
  it('is reached from neither entry of the host, nor from the opening of a ledger for the tests, which loads it when it opens one', () => {
    expect([
      ...driversReachedFrom('index.ts'),
      ...driversReachedFrom('testing/index.ts'),
      ...driversReachedFrom('ledger-testing/ledger-connections.ts'),
    ]).toEqual([]);
  });
});
