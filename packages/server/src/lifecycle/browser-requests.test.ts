import { get } from 'node:http';

import { createApiKey } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { defaultServerOptions } from '../testing/entries/serving-options.ts';
import { startServer } from './lifecycle.ts';

const loopback = { HOST: '127.0.0.1', PORT: '0' };

function statusOf(port: number, path: string, headers: Readonly<Record<string, string>>): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, headers }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
}

describe('startServer validates requests from browsers', () => {
  it('is in local mode on loopback without API keys, so it rejects a Host header that is not localhost', async () => {
    const server = await startServer(loopback, defaultServerOptions);

    const foreign = await statusOf(server.port, '/nowhere', { host: 'evil.example' });
    const local = await statusOf(server.port, '/nowhere', { host: `localhost:${server.port}` });
    await server.stop();

    expect({ foreign, local }).toEqual({ foreign: 403, local: 404 });
  });

  it('is not in local mode once API keys are configured, so it checks the key and not the Host header', async () => {
    const { key, entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });
    const server = await startServer({ ...loopback, API_KEYS: JSON.stringify([entry]) }, defaultServerOptions);

    const withoutKey = await statusOf(server.port, '/v1/orgs/acme/playbooks', { host: 'evil.example' });
    const withKey = await statusOf(server.port, '/v1/orgs/acme/playbooks', {
      host: 'evil.example',
      authorization: `Bearer ${key}`,
    });
    await server.stop();

    expect({ withoutKey, withKey }).toEqual({ withoutKey: 401, withKey: 404 });
  });

  it('rejects a request from an origin ALLOWED_ORIGINS does not list', async () => {
    const server = await startServer({ ...loopback, ALLOWED_ORIGINS: 'https://app.example.com' }, defaultServerOptions);

    const allowed = await statusOf(server.port, '/nowhere', { origin: 'https://app.example.com' });
    const foreign = await statusOf(server.port, '/nowhere', { origin: 'https://evil.example' });
    await server.stop();

    expect({ allowed, foreign }).toEqual({ allowed: 404, foreign: 403 });
  });
});
