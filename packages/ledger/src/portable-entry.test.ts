import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

function packagesReachableFrom(entry: string): readonly string[] {
  return modulesReachedFrom(import.meta.dirname, entry).packages;
}

describe('the ledger entry points', () => {
  it('keep the drivers out of the main entry', () => {
    const packages = packagesReachableFrom('index.ts');

    expect(packages.filter((name) => name.includes('sqlite3'))).toEqual([]);
    expect(packages).not.toContain('pg');
    expect(packages.filter((name) => name.includes('postgresql'))).toEqual([]);
    expect(packages).toContain('@event-driven-io/emmett-sqlite');
  });

  it('keep the drivers out of the testing entry, so a suite run on a driver of its own loads neither', () => {
    const packages = packagesReachableFrom('testing/index.ts');

    expect(packages.filter((name) => name.includes('sqlite3'))).toEqual([]);
    expect(packages.filter((name) => name.includes('postgresql'))).toEqual([]);
    expect(packages).not.toContain('pg');
    expect(packages).toContain('vitest');
  });

  it('keep the PostgreSQL event store and its driver behind the postgresql entry', () => {
    const packages = packagesReachableFrom('postgresql/postgresql-ledger.ts');

    expect(packages).toContain('@event-driven-io/emmett-postgresql');
    expect(packages).toContain('@event-driven-io/emmett-postgresql/pg');
    expect(packages.filter((name) => name.includes('sqlite'))).toEqual([]);
  });

  it('keep the sqlite3 driver and the file system behind the sqlite3 entry', () => {
    const packages = packagesReachableFrom('sqlite3.ts');

    expect(packages).toContain('@event-driven-io/emmett-sqlite/sqlite3');
    expect(packages).toContain('node:fs');
    expect(modulesReachedFrom(import.meta.dirname, 'sqlite3.ts').files).toContain('layout/sqlite-file-in-layout.ts');
  });
});
