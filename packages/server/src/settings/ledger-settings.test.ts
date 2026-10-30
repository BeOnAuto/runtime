import { inspect } from 'node:util';

import type { Environment } from '@on.auto/config';
import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import type { LedgerSettings } from './ledger-settings.ts';
import { type Settings } from './settings.ts';

function settingsOf(environment: Environment): Settings {
  return readSettingsOf({ SECRETS_KEY: secretsKey, ...environment });
}

function errorFrom(environment: Environment): unknown {
  try {
    settingsOf(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

function revealed(ledger: LedgerSettings): unknown {
  return ledger.store === 'postgresql' ? { ...ledger, url: Redacted.value(ledger.url) } : ledger;
}

const password = 'a-secret-password';

const databaseUrl = `postgresql://playbooks:${password}@db.example.com:5432/playbooks`;

describe('the ledger settings', () => {
  it('keep the ledger in PostgreSQL when DATABASE_URL is set, naming its host and database', () => {
    expect(revealed(settingsOf({ DATABASE_URL: databaseUrl }).ledger)).toEqual({
      store: 'postgresql',
      url: databaseUrl,
      host: 'db.example.com:5432',
      database: 'playbooks',
      credentials: { kind: 'url' },
    });
  });

  it('accept a URL that starts postgres: as well as postgresql:', () => {
    expect(settingsOf({ DATABASE_URL: 'postgres://playbooks@10.0.0.7/ledger' }).ledger).toMatchObject({
      store: 'postgresql',
      host: '10.0.0.7',
      database: 'ledger',
    });
  });

  it('hold DATABASE_URL redacted, so the settings never print it', () => {
    const settings = settingsOf({ DATABASE_URL: databaseUrl });

    expect(JSON.stringify(settings.ledger)).toBe(
      '{"store":"postgresql","url":"<redacted>","host":"db.example.com:5432","database":"playbooks","credentials":{"kind":"url"}}',
    );
    expect(inspect(settings, { depth: Number.POSITIVE_INFINITY })).not.toContain(password);
  });

  it('keep the ledger in the SQLite file of LEDGER_FILE when DATABASE_URL is empty', () => {
    expect(settingsOf({ DATABASE_URL: '', LEDGER_FILE: '/data/playbooks.db' }).ledger).toEqual({
      store: 'sqlite',
      file: '/data/playbooks.db',
    });
  });
});

describe('DATABASE_URL as it is written', () => {
  it('is read without the spaces and line breaks around it, which the driver would take as part of it', () => {
    expect(revealed(settingsOf({ DATABASE_URL: ` ${databaseUrl}\n` }).ledger)).toMatchObject({ url: databaseUrl });
  });

  it('names its database decoded, as the driver reads it', () => {
    expect(settingsOf({ DATABASE_URL: 'postgresql://playbooks@db.example.com/post%67res' }).ledger).toMatchObject({
      database: 'postgres',
    });
  });
});

describe('ledger settings the server cannot use', () => {
  it('stop the server from starting when both DATABASE_URL and LEDGER_FILE are set, naming both and neither value', () => {
    const error = String(errorFrom({ DATABASE_URL: databaseUrl, LEDGER_FILE: '/data/ledger.db' }));

    expect(error).toBe(
      'InvalidSettingsError: The ledger settings are invalid. DATABASE_URL: Set DATABASE_URL or LEDGER_FILE, not both',
    );
  });

  it.each([
    `playbooks:${password}@db.example.com/playbooks`,
    `mysql://playbooks:${password}@db.example.com/playbooks`,
    `postgresql://playbooks:${password}@/playbooks`,
    'postgresql:///playbooks',
    `postgresql://playbooks:${password}@db.example.com`,
    `postgresql://playbooks:${password}@db.example.com/`,
    `postgresql://playbooks:${password}@db.example.com/%E0%A4%A`,
  ])('stop the server from starting when DATABASE_URL is %s, which names no PostgreSQL database', (url) => {
    const error = String(errorFrom({ DATABASE_URL: url }));

    expect(error).toBe(
      'InvalidSettingsError: The ledger settings are invalid. DATABASE_URL: Expected a PostgreSQL URL such as postgresql://user:password@host:5432/database',
    );
  });
});
