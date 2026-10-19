import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApiKey } from '@on.auto/identity';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { besideTheLedgerFile, readLedgerSettings } from '../settings/ledger-settings.ts';
import { readSettings } from '../settings/settings.ts';
import { studioFolderName } from './served-studio.ts';

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const loopback = { HOST: '127.0.0.1' };

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettings(environment);
  } catch (error) {
    return String(error);
  }
  return '';
}

describe('the Studio settings of a runtime in local mode', () => {
  it('serve Studio, fetched from the Studio host of Auto, by default', () => {
    expect(readSettings(loopback).studio).toEqual({ origin: 'https://studio.on.auto', served: true });
  });

  it('serve none on an address beyond the loopback with neither PUBLIC_URL nor API_KEYS, which is no local mode', () => {
    expect(readSettings({ HOST: '0.0.0.0' }).studio.served).toBe(false);
  });

  it('serve none where SERVE_STUDIO is false', () => {
    expect(readSettings({ ...loopback, SERVE_STUDIO: 'false' }).studio.served).toBe(false);
  });
});

const withCredentials: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['PUBLIC_URL', { PUBLIC_URL: 'https://runtime.example.com' }],
  ['API_KEYS', { API_KEYS: JSON.stringify([entry]) }],
];

describe('the Studio settings of a runtime with a public address or keys', () => {
  it.each(withCredentials)('serve no Studio by default where %s is set', (_case, environment) => {
    expect(readSettings(environment).studio).toEqual({ origin: 'https://studio.on.auto', served: false });
  });

  it('serve Studio where the operator sets SERVE_STUDIO to true', () => {
    expect(readSettings({ PUBLIC_URL: 'https://runtime.example.com', SERVE_STUDIO: 'true' }).studio.served).toBe(true);
  });
});

describe('the Studio host a runtime names', () => {
  it.each([
    'https://studio.example.com',
    'https://studio.example.com:8443',
    'http://localhost:3200',
    'http://127.0.0.1:3200',
    'http://[::1]:3200',
  ])('is taken from STUDIO_ORIGIN=%s', (origin) => {
    expect(readSettings({ STUDIO_ORIGIN: origin }).studio.origin).toBe(origin);
  });

  it.each([
    'https://studio.example.com/',
    'https://studio.example.com/studio',
    'studio.example.com',
    'ftp://studio.example.com',
  ])('is refused as STUDIO_ORIGIN=%s, which is no origin, naming the setting', (origin) => {
    expect(errorFrom({ STUDIO_ORIGIN: origin })).toBe(
      'InvalidSettingsError: SchemaError(Expected an https URL with no path, query or fragment, such as https://studio.on.auto\n  at ["STUDIO_ORIGIN"])',
    );
  });

  it('is refused over http on any address but the loopback', () => {
    expect(errorFrom({ STUDIO_ORIGIN: 'http://studio.example.com' })).toBe(
      'InvalidSettingsError: STUDIO_ORIGIN: Expected an https URL; an http URL is taken only for localhost, 127.0.0.1, or [::1]',
    );
  });
});

describe('the Studio settings in the configuration file', () => {
  it('are read as studio_origin and serve_studio', () => {
    const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-studio-settings-'));
    onTestFinished(() => {
      rmSync(folder, { recursive: true, force: true });
    });
    const configFile = join(folder, 'auto-runtime.yaml');
    writeFileSync(configFile, 'studio_origin: http://127.0.0.1:3200\nserve_studio: false\n');

    expect(readSettings({ ...loopback, CONFIG_FILE: configFile }).studio).toEqual({
      origin: 'http://127.0.0.1:3200',
      served: false,
    });
  });
});

describe('SERVE_STUDIO', () => {
  it.each(['yes', 'TRUE', '1'])('refuses %s, naming the values it takes', (value) => {
    expect(errorFrom({ SERVE_STUDIO: value })).toBe(
      'InvalidSettingsError: SchemaError(Expected "true" | "false"\n  at ["SERVE_STUDIO"])',
    );
  });
});

describe('the folder a runtime keeps the answers of the Studio host in', () => {
  it('is a folder of its own beside a SQLite ledger file, and none for a ledger in memory or in PostgreSQL', () => {
    const postgresql = Effect.runSync(
      readLedgerSettings({ DATABASE_URL: 'postgresql://ledger@db.example.com:5432/ledger' }),
    );

    expect([
      besideTheLedgerFile({ store: 'sqlite', file: '/data/ledger.db' }, studioFolderName),
      besideTheLedgerFile({ store: 'sqlite', file: ':memory:' }, studioFolderName),
      besideTheLedgerFile(postgresql, studioFolderName),
    ]).toEqual(['/data/auto-runtime-studio', undefined, undefined]);
  });
});
