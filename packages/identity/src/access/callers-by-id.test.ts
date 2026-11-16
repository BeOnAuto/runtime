import { describe, expect, it } from 'vitest';

import { callersByIdOf, configuredApiKeys, createApiKey, type ApiKey } from '../index.ts';

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] });

const writer = createApiKey({ id: 'acme-writer', org: 'acme', permissions: ['playbook:write'], playbooks: '*' });

const keys: readonly ApiKey[] = [reader.entry, writer.entry];

const withKeys = {
  host: '0.0.0.0',
  apiKeys: keys,
  apiKeySource: configuredApiKeys(keys),
  signsIn: false,
};

const inLocalMode = {
  host: '127.0.0.1',
  apiKeys: undefined,
  apiKeySource: configuredApiKeys([]),
  signsIn: false,
  localAccount: () => ({ username: 'ada' }),
};

describe('a caller read again by its id, as the server would take it now', () => {
  it('is the key of that id as the server is configured now, in the org the key belongs to', async () => {
    const { callerOf } = callersByIdOf(withKeys);

    expect([
      await callerOf('acme', 'acme-writer'),
      await callerOf('acme', 'acme-reader'),
      await callerOf('globex', 'acme-writer'),
      await callerOf('acme', 'acme-revoked'),
    ]).toEqual([
      { id: 'acme-writer', name: 'acme-writer', org: 'acme', permissions: ['playbook:write'], playbooks: '*' },
      { id: 'acme-reader', name: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] },
      undefined,
      undefined,
    ]);
  });

  it('is the local developer in local mode alone, in any org, and no key there', async () => {
    const local = callersByIdOf(inLocalMode).callerOf;
    const withCredentials = callersByIdOf(withKeys).callerOf;

    expect([
      await local('acme', 'local'),
      await local('acme', 'acme-writer'),
      await withCredentials('acme', 'local'),
    ]).toEqual([
      {
        id: 'local',
        name: 'ada',
        org: 'acme',
        permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'],
        playbooks: '*',
      },
      undefined,
      undefined,
    ]);
  });

  it('is nobody for a signed-in person, whose grant comes with each token they present and is kept nowhere', async () => {
    expect(await callersByIdOf({ ...withKeys, signsIn: true }).callerOf('acme', 'person:ada')).toBeUndefined();
  });

  it('is nobody on a server that admits nobody', async () => {
    expect(await callersByIdOf({ ...withKeys, apiKeys: [] }).callerOf('acme', 'acme-writer')).toBeUndefined();
  });
});

describe('the kind of a caller this server can read again by its id', () => {
  it('is a key, whether or not the server lists it now, where the server takes credentials or admits nobody', () => {
    const { readsAgain } = callersByIdOf({ ...withKeys, signsIn: true });
    const closed = callersByIdOf({ ...withKeys, apiKeys: [] }).readsAgain;

    expect([
      readsAgain('acme-writer'),
      readsAgain('acme-revoked'),
      closed('acme-writer'),
      readsAgain('person:ada'),
      readsAgain('local'),
    ]).toEqual([true, true, true, false, false]);
  });

  it('is the local developer alone in local mode, and never a signed-in person, whose grant is kept nowhere', () => {
    const { readsAgain } = callersByIdOf(inLocalMode);

    expect([readsAgain('local'), readsAgain('acme-writer'), readsAgain('person:ada')]).toEqual([true, false, false]);
  });
});
