import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { licensePath, meteredServer } from '../metering-testing/fixture.ts';
import { accessTokenOf, issuerOverHttps } from '../sign-in/issuer-over-https.ts';

const operator = createApiKey({
  id: 'installation-operator',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
});
const owner = createApiKey({ id: 'workspace-owner', org: 'acme', permissions: allPermissions, playbooks: '*' });

describe('signed-in workspace members and installation control', () => {
  it('does not turn a signed-in member into an operator through a matching allowlist string', async () => {
    const issuer = await issuerOverHttps();
    const audience = 'http://localhost:5555';
    const server = await meteredServer({ IDENTITY_ISSUER: issuer.issuer, PUBLIC_URL: audience }, ['person:user|ada']);
    const key = await accessTokenOf(issuer, audience, ['user:org:read', ...allPermissions].join(' '));
    expect(
      await server.call('POST', '/v1/orgs/acme/playbooks', { key, body: { playbook: 'alpha', name: 'Alpha' } }),
    ).toMatchObject({ status: 201 });
    expect(await server.call('GET', licensePath, { key })).toMatchObject({ status: 403 });
    expect(server.authority.requests).toEqual([]);
  });
});

describe('installation operator authorization', () => {
  it('requires explicit operator provisioning even for a key with every workspace permission', async () => {
    const server = await meteredServer({ API_KEYS: JSON.stringify([operator.entry, owner.entry]) }, [
      operator.entry.id,
    ]);
    expect(await server.call('GET', licensePath)).toMatchObject({ status: 401 });
    expect(await server.call('GET', licensePath, { key: owner.key })).toMatchObject({ status: 403 });
    expect(
      await server.call('POST', `${licensePath}/activate`, {
        key: owner.key,
        body: { activationKey: 'activation-secret' },
      }),
    ).toMatchObject({ status: 403 });
    expect(server.authority.requests).toEqual([]);
    expect(await server.call('GET', licensePath, { key: operator.key })).toMatchObject({
      status: 200,
      body: { usable: false },
    });
    expect(
      await server.call('POST', `${licensePath}/activate`, {
        key: operator.key,
        body: { activationKey: 'activation-secret' },
      }),
    ).toMatchObject({ status: 200 });
  });

  it('retains browser origin protection and never caches license or allocation details', async () => {
    const server = await meteredServer();
    const denied = await fetch(`${server.origin}${licensePath}/activate`, {
      method: 'POST',
      headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
      body: JSON.stringify({ activationKey: 'activation-secret' }),
    });
    expect(denied.status).toBe(403);
    expect(server.authority.requests).toEqual([]);
    const read = await server.call('GET', licensePath);
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(read.text).not.toContain('activation-secret');
    expect(read.text).not.toContain('privateKey');
  });
});
