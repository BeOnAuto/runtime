import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

function packagesReachableFrom(entry: string): readonly string[] {
  return modulesReachedFrom(import.meta.dirname, entry).packages;
}

function entriesOfPg(packages: readonly string[]): readonly string[] {
  return packages.filter((name) => name === 'pg' || name.endsWith('/pg'));
}

function entriesOfSQLite(packages: readonly string[]): readonly string[] {
  return packages.filter((name) => name === 'node:sqlite' || name === '@on.auto/node-sqlite');
}

describe('the ledger entry points', () => {
  it('keep the drivers out of the main entry', () => {
    const packages = packagesReachableFrom('index.ts');

    expect(entriesOfSQLite(packages)).toEqual([]);
    expect(entriesOfPg(packages)).toEqual([]);
    expect(packages.filter((name) => name.includes('postgresql'))).toEqual([]);
    expect(packages).toContain('@event-driven-io/emmett-sqlite');
  });

  it('keep the drivers out of the testing entry, so a suite run on a driver of its own loads neither', () => {
    const packages = packagesReachableFrom('testing/index.ts');

    expect(entriesOfSQLite(packages)).toEqual([]);
    expect(packages.filter((name) => name.includes('postgresql'))).toEqual([]);
    expect(entriesOfPg(packages)).toEqual([]);
    expect(packages).toContain('vitest');
  });

  it('keep the PostgreSQL event store and its driver behind the postgresql entry', () => {
    const packages = packagesReachableFrom('postgresql/postgresql-ledger.ts');

    expect(packages).toContain('@event-driven-io/emmett-postgresql');
    expect(packages).toContain('@event-driven-io/emmett-postgresql/pg');
    expect(packages.filter((name) => name.includes('sqlite'))).toEqual([]);
  });

  it('keep the driver of node:sqlite and the file system behind the sqlite entry', () => {
    const packages = packagesReachableFrom('sqlite.ts');

    expect(packages).toContain('@on.auto/node-sqlite');
    expect(packages).toContain('node:fs');
    expect(modulesReachedFrom(import.meta.dirname, 'sqlite.ts').files).toContain('layout/sqlite-file-in-layout.ts');
  });
});
