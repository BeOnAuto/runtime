import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { openedOn } from '../testing/host-files.ts';

const stream = 'playbook/acme/alpha/run-logs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

describe('the store of a host database on a ledger opened with an observer', () => {
  it('tells the observer of each append it keeps', async () => {
    const told: string[] = [];
    const database = await openedOn({
      store: 'sqlite',
      file: ':memory:',
      observer: {
        appended: (appendedTo, events) => {
          told.push(`${appendedTo} ${events.length}`);
        },
      },
    });

    await database.store.append(stream, [{ type: 'counted', data: { n: 1 } }], {
      expectedVersion: 0,
      context: { at: '2026-10-13T09:00:00.000Z', by: 'tester' },
    });

    expect(told).toEqual([`${stream} 1`]);
  });
});

const sources = fileURLToPath(new URL('..', import.meta.url));

const drivers: ReadonlySet<string> = new Set([
  '@on.auto/ledger/sqlite',
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
