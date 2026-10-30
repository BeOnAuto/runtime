import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { type RunningServer } from '../server-options/server-options.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request } from '../testing/servers/http-client.ts';

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: '*',
});

const acmeAlphaAndDelta = createApiKey({
  id: 'acme-alpha-delta',
  org: 'acme',
  permissions: allPermissions,
  playbooks: ['alpha', 'delta'],
});

const globexAdmin = createApiKey({ id: 'globex-admin', org: 'globex', permissions: allPermissions, playbooks: '*' });

const apiKeys = JSON.stringify([acmeAdmin.entry, acmeReader.entry, acmeAlphaAndDelta.entry, globexAdmin.entry]);

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(async () => {
  ledger = temporaryLedger();
  server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      PREDICTION_CACHE_DIR: ledger.cacheDirectory,
      API_KEYS: apiKeys,
    },
    compositionRoot,
  );
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

describe('the playbooks of an org with API keys', () => {
  it('rejects a key of another org with the same 403 for an existing and a missing playbook', async () => {
    await request(server.port, 'POST', '/v1/orgs/globex/playbooks', {
      key: globexAdmin.key,
      body: { playbook: 'gamma', name: 'G' },
    });

    const existing = await request(server.port, 'GET', '/v1/orgs/globex/playbooks/gamma', { key: acmeAdmin.key });
    const missing = await request(server.port, 'GET', '/v1/orgs/globex/playbooks/nowhere', { key: acmeAdmin.key });
    const listing = await request(server.port, 'GET', '/v1/orgs/globex/playbooks', { key: acmeAdmin.key });

    expect(existing).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
    expect(missing.text).toBe(existing.text);
    expect(listing.status).toBe(403);
    expect(
      await request(server.port, 'GET', '/v1/orgs/globex/playbooks/gamma', { key: globexAdmin.key }),
    ).toMatchObject({
      status: 200,
    });
  });
});

describe('the permissions and playbooks of an API key', () => {
  it('reject a read-only key on create, and let it list', async () => {
    const creating = await request(server.port, 'POST', '/v1/orgs/acme/playbooks', {
      key: acmeReader.key,
      body: { playbook: 'alpha', name: 'Alpha' },
    });

    expect(creating).toMatchObject({ status: 403, body: { detail: 'The caller lacks the org:write permission' } });
    expect(await request(server.port, 'GET', '/v1/orgs/acme/playbooks', { key: acmeReader.key })).toMatchObject({
      status: 200,
      body: { playbooks: [] },
    });
  });

  it('confine a key limited to some playbooks to those playbooks, in every operation and in the list', async () => {
    await request(server.port, 'POST', '/v1/orgs/acme/playbooks', {
      key: acmeAdmin.key,
      body: { playbook: 'alpha', name: 'A' },
    });
    await request(server.port, 'POST', '/v1/orgs/acme/playbooks', {
      key: acmeAdmin.key,
      body: { playbook: 'beta', name: 'B' },
    });
    const as = { key: acmeAlphaAndDelta.key };

    const readingBeta = await request(server.port, 'GET', '/v1/orgs/acme/playbooks/beta', as);
    const creatingEpsilon = await request(server.port, 'POST', '/v1/orgs/acme/playbooks', {
      ...as,
      body: { playbook: 'epsilon', name: 'Epsilon' },
    });
    const creatingDelta = await request(server.port, 'POST', '/v1/orgs/acme/playbooks', {
      ...as,
      body: { playbook: 'delta', name: 'Delta' },
    });
    const listing = await request(server.port, 'GET', '/v1/orgs/acme/playbooks', as);

    expect([readingBeta.status, creatingEpsilon.status, creatingDelta.status]).toEqual([403, 403, 201]);
    expect(listing.body).toMatchObject({ playbooks: [{ id: 'alpha' }, { id: 'delta' }] });
  });
});
