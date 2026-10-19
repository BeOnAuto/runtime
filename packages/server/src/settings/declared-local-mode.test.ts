import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { authenticatorFor, createApiKey } from '@on.auto/identity';
import { principalIn } from '@on.auto/identity/testing';
import { Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { defaultServerOptions, startServer, type RunningServer } from '../lifecycle/lifecycle.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { readSettings } from './settings.ts';

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const declared = { HOST: '0.0.0.0', ACCESS_MODE: 'local' };

const inAContainer = { ...declared, PUBLIC_URL: 'http://localhost:5555' };

const keysRefused =
  'ACCESS_MODE: local takes no API_KEYS, since in local mode every request acts as the local developer; set one or the other';

const publicAddressRefused =
  'ACCESS_MODE: local takes a PUBLIC_URL only on localhost, 127.0.0.1, or [::1], since a runtime at a public address is never in local mode';

const addressNeeded =
  'ACCESS_MODE: local on HOST 0.0.0.0 needs PUBLIC_URL, the address on localhost, 127.0.0.1, or [::1] at which this computer reaches the runtime, such as http://localhost:5555, since local mode refuses a request whose Host names 0.0.0.0';

function aLedger(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(() => {
    ledger.remove();
  });
  return ledger;
}

function startOf(environment: Readonly<Record<string, string>>): Promise<RunningServer> {
  const starting = startServer({ PORT: '0', LEDGER_FILE: aLedger().fileName, ...environment }, defaultServerOptions);
  onTestFinished(async () => {
    await (await starting.catch(Function.constUndefined))?.stop();
  });
  return starting;
}

describe('a runtime whose operator declares local mode with ACCESS_MODE=local', () => {
  it('is in local mode on every address, admitting a request with no credential as the local developer of the org local, with the served Studio on and no one signed in', async () => {
    const settings = readSettings(inAContainer);
    const authenticator = authenticatorFor({ ...settings, identityService: undefined });
    const developer = principalIn(await authenticator.authenticate(undefined, '/v1/orgs/acme/playbooks'));

    expect([authenticator.mode, developer?.own.org, settings.studio.served, settings.signIn]).toEqual([
      'local',
      'local',
      true,
      undefined,
    ]);
    expect(() => authenticatorFor({ ...readSettings({ HOST: '0.0.0.0' }), identityService: undefined })).toThrow(
      'A server reachable beyond this computer needs PUBLIC_URL',
    );
  });

  it('takes its PUBLIC_URL on the loopback as the address of the runtime, and signs no one in with it', () => {
    expect(readSettings(inAContainer)).toMatchObject({
      accessMode: 'local',
      publicUrl: 'http://localhost:5555',
      signIn: undefined,
    });
  });

  it('needs no PUBLIC_URL on a loopback address, whose links point at that address', () => {
    expect(readSettings({ HOST: '127.0.0.1', ACCESS_MODE: 'local' })).toMatchObject({
      accessMode: 'local',
      publicUrl: undefined,
      studio: { served: true },
    });
  });

  it('is declared in the configuration file as access_mode', () => {
    const file = join(aLedger().directory, 'auto-runtime.yaml');
    writeFileSync(file, 'access_mode: local\n');
    const settings = readSettings({ HOST: '0.0.0.0', PUBLIC_URL: 'http://localhost:5555', CONFIG_FILE: file });

    expect([settings.accessMode, authenticatorFor({ ...settings, identityService: undefined }).mode]).toEqual([
      'local',
      'local',
    ]);
  });
});

const refusals: ReadonlyArray<readonly [string, Readonly<Record<string, string>>, string]> = [
  ['API_KEYS', { ...inAContainer, API_KEYS: JSON.stringify([entry]) }, keysRefused],
  ['API_KEYS that lists no keys', { ...inAContainer, API_KEYS: '[]' }, keysRefused],
  ['a PUBLIC_URL off the loopback', { ...declared, PUBLIC_URL: 'https://runtime.example.com' }, publicAddressRefused],
  ['no PUBLIC_URL, on an address beyond the loopback', declared, addressNeeded],
];

describe('ACCESS_MODE=local beside what local mode cannot take', () => {
  it.each(refusals)('stops the start beside %s, saying why', async (_case, environment, refusal) => {
    await expect(startOf(environment)).rejects.toThrow(refusal);
  });
});

describe('ACCESS_MODE', () => {
  it.each(['credentials', 'closed', 'LOCAL'])('stops the start as %s, naming the one value it takes', async (mode) => {
    await expect(startOf({ ...inAContainer, ACCESS_MODE: mode })).rejects.toThrow(
      'SchemaError(Expected "local"\n  at ["ACCESS_MODE"])',
    );
  });
});
