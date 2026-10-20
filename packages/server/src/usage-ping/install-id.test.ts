import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { installIdFileOf, installIn } from './install-id.ts';

function folderOfTheTest(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-install-'));
  onTestFinished(() => {
    chmodSync(folder, 0o700);
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('the file that keeps the install id', () => {
  it('is beside the ledger file, as the secrets key is', () => {
    expect(installIdFileOf({ store: 'sqlite', file: '/data/ledger.db' }, '/home/node/.auto-runtime')).toBe(
      '/data/install-id',
    );
  });

  it('is in the runtime home where the ledger has no file', () => {
    const inPostgreSQL = {
      store: 'postgresql',
      url: Redacted.make('postgresql://runtime@db/ledger'),
      host: 'db',
      database: 'ledger',
      credentials: { kind: 'url' },
    } as const;

    expect([
      installIdFileOf({ store: 'sqlite', file: ':memory:' }, '/Users/ada/.auto-runtime'),
      installIdFileOf(inPostgreSQL, '/Users/ada/.auto-runtime'),
    ]).toEqual(['/Users/ada/.auto-runtime/install-id', '/Users/ada/.auto-runtime/install-id']);
  });
});

describe('the install of a runtime', () => {
  it('is made at the first start, with a random id kept in its file and its folder made', () => {
    const file = join(folderOfTheTest(), '.auto-runtime', 'install-id');

    const install = installIn(file);

    expect(install?.id).toMatch(uuid);
    expect(install?.isNew).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(`${String(install?.id)}\n`);
  });

  it('is the same one at every later start', () => {
    const file = join(folderOfTheTest(), 'install-id');
    const first = installIn(file);

    expect(installIn(file)).toEqual({ id: first?.id, isNew: false });
  });

  it('is the id another start kept in the file', () => {
    const file = join(folderOfTheTest(), 'install-id');
    writeFileSync(file, '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b\n');

    expect(installIn(file)).toEqual({ id: '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b', isNew: false });
  });

  it('is none, and the file stays as it is, where the file holds no id', () => {
    const file = join(folderOfTheTest(), 'install-id');
    writeFileSync(file, 'not an id\n');

    expect(installIn(file)).toBeUndefined();
    expect(readFileSync(file, 'utf8')).toBe('not an id\n');
  });

  it('is none where the file cannot be read', () => {
    const file = join(folderOfTheTest(), 'install-id');
    mkdirSync(file);

    expect(installIn(file)).toBeUndefined();
  });

  it('is none, rather than a new id at each start, where the folder cannot be written to', () => {
    const folder = folderOfTheTest();
    chmodSync(folder, 0o500);
    const file = join(folder, 'install-id');

    expect([installIn(file), installIn(file)]).toEqual([undefined, undefined]);
    expect(existsSync(file)).toBe(false);
  });
});
