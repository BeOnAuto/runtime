import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { accountsServed, installation, runtimeIdOf, servedBy, studio } from '../testing/accounts/licensed-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { tallied, tallyCreated } from '../testing/servers/tally-server.ts';

const license = '/v1/orgs/acme/license';

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] });

const globex = createApiKey({ id: 'globex-admin', org: 'globex', permissions: allPermissions, playbooks: '*' });

const detailIn = Schema.decodeUnknownSync(Schema.Struct({ detail: Schema.String }));

const uuid = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/u;

async function served(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  const server = await servingReasoning([], { STUDIO_ORIGIN: studio, ...environment });
  onTestFinished(() => server.stop());
  return server;
}

function pageOf(server: ReasoningServer): Promise<string> {
  return fetch(`${server.origin}/`, { headers: { accept: 'text/html' } }).then((page) => page.text());
}

describe('the license a runtime nobody registered holds', () => {
  it('reads unregistered, with its id and the free runs it used, which the page at its root says too', async () => {
    const server = await served();
    await tallyCreated(server);
    const before = await server.call('GET', license);
    await tallied(server);
    await tallied(server);
    const after = await server.call('GET', license);
    const runtimeId = await runtimeIdOf(server);

    expect(before).toMatchObject({ status: 200, body: { state: 'unregistered', free_runs: { used: 0, of: 100 } } });
    expect(after.body).toEqual({
      state: 'unregistered',
      runtime_id: runtimeId,
      free_runs: { used: 2, of: 100 },
      org: null,
      org_name: null,
      plan: null,
      expires_at: null,
      renewed_at: null,
      key_source: null,
      offline: null,
      invalid_because: null,
    });
    expect(runtimeId).toMatch(uuid);
    expect(await pageOf(server)).toContain(
      '<p class="license">2 of 100 free runs used, then a free key from Studio</p>',
    );
  });

  it('is read by every member of an org, and by no caller without a key or of another org', async () => {
    const server = await served({ API_KEYS: JSON.stringify([reader.entry, globex.entry]) });

    expect((await server.call('GET', license, { key: reader.key })).status).toBe(200);
    expect((await server.call('GET', license)).status).toBe(401);
    expect((await server.call('GET', license, { key: globex.key })).status).toBe(403);
    expect(await pageOf(server)).not.toContain('class="license"');
  });
});

describe('the license a licensed runtime holds', () => {
  it('reads licensed to its org on its plan, renewed and ending as Auto signed it, by a key of the environment', async () => {
    const accounts = await accountsServed();
    const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key });
    await tallied(server);

    expect((await server.call('GET', license)).body).toEqual({
      state: 'licensed',
      runtime_id: installation,
      free_runs: { used: 1, of: 100 },
      org: 'acme',
      org_name: null,
      plan: 'free',
      expires_at: '2026-11-03T12:00:00.000Z',
      renewed_at: '2026-10-27T12:00:00.000Z',
      key_source: 'environment',
      offline: null,
      invalid_because: null,
    });
    expect(await pageOf(server)).toContain('<p class="license">Licensed to acme (free plan)</p>');
  });

  it('says its key came from its configuration file, or from an activation', async () => {
    const accounts = await accountsServed();
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const configFile = join(ledger.directory, 'auto-runtime.yaml');
    writeFileSync(configFile, 'license:\n  key: ${ACME_LICENSE_KEY}\n');
    const configured = await servedBy(
      accounts,
      { CONFIG_FILE: configFile, ACME_LICENSE_KEY: accounts.key },
      { ledger },
    );
    await tallied(configured);
    const activating = await servedBy(accounts);
    await activating.call('POST', license, { body: { key: accounts.key } });

    expect((await configured.call('GET', license)).body).toMatchObject({ key_source: 'configuration' });
    expect((await activating.call('GET', license)).body).toMatchObject({ state: 'licensed', key_source: 'activated' });
  });
});

describe('the license of a runtime whose org Auto names', () => {
  it('reads the name of its org as Auto signed it, which the page at its root says in place of the id', async () => {
    const accounts = await accountsServed();
    accounts.account.orgNamed('acme', 'Acme Corporation');
    const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key });
    await tallied(server);

    expect((await server.call('GET', license)).body).toMatchObject({
      state: 'licensed',
      org: 'acme',
      org_name: 'Acme Corporation',
    });
    expect(await pageOf(server)).toContain('<p class="license">Licensed to Acme Corporation (free plan)</p>');
  });
});

describe('the license of a runtime whose key was rotated', () => {
  it('reads invalid in the words a run is refused in once the account says its key was rotated', async () => {
    const accounts = await accountsServed();
    const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key });
    await tallied(server);
    accounts.account.revoke(accounts.key, 'key_rotated');
    const refused = await tallied(server);

    expect((await server.call('GET', license)).body).toMatchObject({
      state: 'invalid',
      invalid_because: detailIn(refused.body).detail,
    });
  });
});

describe('the license an offline installation holds', () => {
  it('reads offline, with the credits of its allocation, what it spent and until when they may be used', async () => {
    const accounts = await accountsServed();
    const allocation = accounts.account.allocationFor(installation, 5);
    accounts.account.goDown();
    const server = await servedBy(accounts, { AUTO_RUNTIME_ALLOCATION: JSON.stringify(allocation) });
    await tallied(server);

    expect((await server.call('GET', license)).body).toMatchObject({
      state: 'offline',
      runtime_id: installation,
      offline: { credits: 5, spent: 1, usable_until: '2026-11-03T12:00:00.000Z' },
    });
    expect(await pageOf(server)).toContain(
      '<p class="license">Offline credits: 1 of 5 used, usable until 2026-11-03</p>',
    );
  });
});
