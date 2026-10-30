import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApiKey } from '@on.auto/identity';
import { describe, expect, it, onTestFinished } from 'vitest';

import { variablesTheRuntimeReads } from '../connections/variables-the-runtime-reads.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { autoClientsOf, returnKindOf } from './consent-settings.ts';

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const loopback = { HOST: '127.0.0.1' };

const signingIn = { PUBLIC_URL: 'https://runtime.example.com' };

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return String(error);
  }
  return '';
}

function switchOf(environment: Readonly<Record<string, string>>): boolean {
  return readSettingsOf(environment).autoClients.enabled;
}

function connectionsOf(setting: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(setting);
}

function fileHolding(text: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-consent-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true });
  });
  const file = join(folder, 'auto-runtime.yaml');
  writeFileSync(file, text);
  return file;
}

describe('the switch of Auto’s clients', () => {
  it('is on by default in local mode, and off by default where people sign in or keys are taken', () => {
    expect([switchOf(loopback), switchOf(signingIn), switchOf({ API_KEYS: JSON.stringify([entry]) })]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('is what AUTO_CLIENTS says, which wins over the setting of connections, and what that setting says otherwise', () => {
    expect([
      switchOf({ ...loopback, AUTO_CLIENTS: 'false' }),
      switchOf({ ...signingIn, AUTO_CLIENTS: 'true' }),
      switchOf({ ...loopback, CONNECTIONS: connectionsOf({ auto_clients: false }) }),
      switchOf({ ...signingIn, CONNECTIONS: connectionsOf({ auto_clients: true }) }),
      switchOf({ ...loopback, AUTO_CLIENTS: 'true', CONNECTIONS: connectionsOf({ auto_clients: false }) }),
    ]).toEqual([false, true, false, true, true]);
  });

  it('is read from connections.auto_clients of the configuration file', () => {
    const file = fileHolding('connections:\n  auto_clients: false\n');

    expect(switchOf({ ...loopback, CONFIG_FILE: file })).toBe(false);
  });

  it('is refused at start for a value other than true or false, naming the setting', () => {
    expect(errorFrom({ ...loopback, AUTO_CLIENTS: 'yes' })).toContain('AUTO_CLIENTS');
  });
});

describe('the address of Auto’s consent service', () => {
  it('is https://consent.on.auto by default, and any https origin, or an http one on the loopback for a test', () => {
    expect([
      readSettingsOf(loopback).autoClients.serviceUrl,
      readSettingsOf({ ...loopback, CONSENT_SERVICE_URL: 'https://consent.example.com' }).autoClients.serviceUrl,
      readSettingsOf({ ...loopback, CONSENT_SERVICE_URL: 'http://127.0.0.1:19650' }).autoClients.serviceUrl,
    ]).toEqual(['https://consent.on.auto', 'https://consent.example.com', 'http://127.0.0.1:19650']);
  });

  it('is refused at start where it is http off the loopback, or more than an origin', () => {
    expect([
      errorFrom({ ...loopback, CONSENT_SERVICE_URL: 'http://consent.example.com' }),
      errorFrom({ ...loopback, CONSENT_SERVICE_URL: 'https://consent.example.com/v1' }),
    ]).toEqual([
      'InvalidSettingsError: CONSENT_SERVICE_URL: Expected an https URL; an http URL is taken only for localhost, 127.0.0.1, or [::1]',
      'InvalidSettingsError: SchemaError(Expected an https URL with no path, query or fragment, such as https://consent.on.auto\n  at ["CONSENT_SERVICE_URL"])',
    ]);
  });

  it('is named by variables the runtime reads for itself, which no connection may send', () => {
    expect(variablesTheRuntimeReads).toEqual(expect.arrayContaining(['AUTO_CLIENTS', 'CONSENT_SERVICE_URL']));
    expect(errorFrom({ ...loopback, CONNECTIONS: connectionsOf({ variables: ['AUTO_CLIENTS'] }) })).toContain(
      'AUTO_CLIENTS is a variable the runtime reads for itself, which no connection may name',
    );
  });
});

describe('the return the base of a Studio asks of Auto’s consent service', () => {
  it('is to the Studio host for its own base, to a base on this computer by its loopback, and elsewhere otherwise', () => {
    const kindOf = returnKindOf({ origin: 'https://studio.on.auto', served: false });

    expect(
      [
        'https://studio.on.auto/',
        'http://127.0.0.1:5555/studio/',
        'http://localhost:5555/studio/',
        'http://[::1]:5555/studio/',
        'https://runtime.example.com/studio/',
        'https://studio.example.com/',
      ].map((base) => kindOf(base)),
    ).toEqual(['hosted', 'loopback', 'loopback', 'loopback', 'elsewhere', 'elsewhere']);
  });

  it('is to the loopback for a Studio host on this computer, whose page only this computer reaches', () => {
    expect(returnKindOf({ origin: 'http://localhost:5173', served: false })('http://localhost:5173/')).toBe('loopback');
  });

  it('is judged by the client the runtime makes, beside the switch and the service it names', () => {
    const autoClients = autoClientsOf(
      { enabled: true, serviceUrl: 'https://consent.example.com' },
      { origin: 'https://studio.on.auto', served: false },
    );

    expect([autoClients.enabled, autoClients.service, autoClients.returnKindOf('https://studio.on.auto/')]).toEqual([
      true,
      { url: 'https://consent.example.com' },
      'hosted',
    ]);
  });
});
