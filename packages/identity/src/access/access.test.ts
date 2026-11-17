import { playbookCallerOf } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import {
  type AccessFacts,
  type AccessMode,
  accessModeOf,
  type ApiKey,
  authenticatorFor,
  callersByIdOf,
  configuredApiKeys,
  createApiKey,
  isHttpsOrLoopback,
  isKeyHolder,
  isSignedInPerson,
  listensOnlyOnLoopback,
  loopbackNames,
  namesTheLoopback,
} from '../index.ts';
import { fakeIssuer, principalIn, signedTokens } from '../testing/index.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: ['org:write'], playbooks: '*' });

describe('a signed-in person', () => {
  it('is the caller of a token of the identity service, and neither a key nor the local developer', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'));
    const signingIn = authenticatorFor({ host: '0.0.0.0', apiKeys: [admin.entry], identityService });
    const local = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined });

    const ids = [
      principalIn(await signingIn.authenticate(await token(), '/mcp'))?.own.id,
      principalIn(await signingIn.authenticate(admin.key, '/mcp'))?.own.id,
      principalIn(await local.authenticate(undefined, '/mcp'))?.own.id,
    ];

    expect(ids).toEqual(['person:ada', 'acme-admin', 'local']);
    expect(ids.map((id = '') => isSignedInPerson({ id }))).toEqual([true, false, false]);
  });
});

describe('a key holder', () => {
  it('is the caller of a key, and neither a signed-in person, the local developer nor a playbook acting as itself', () => {
    const ids = ['acme-admin', 'person:ada', 'local', playbookCallerOf({ org: 'acme', playbook: 'alpha' }).id];

    expect(ids.map((id) => isKeyHolder({ id }))).toEqual([true, false, false, false]);
  });
});

describe('the names of the loopback', () => {
  it('are localhost, 127.0.0.1 and [::1], as the host of a URL writes them', () => {
    expect(loopbackNames).toEqual(['localhost', '127.0.0.1', '[::1]']);
    expect(
      [
        'localhost',
        '127.0.0.1',
        '[::1]',
        new URL('http://LocalHost:5555/').hostname,
        '127.0.0.2',
        '::1',
        'evil.example',
      ].map((hostname) => namesTheLoopback(hostname)),
    ).toEqual([true, true, true, true, false, false, false]);
  });
});

describe('an origin a browser is sent to', () => {
  it('is an https origin, or an origin on a loopback name, and never what does not parse as one', () => {
    expect(
      [
        'https://runtime.example',
        'http://localhost:5555',
        'http://127.0.0.1',
        'http://[::1]:5555',
        'http://runtime.example',
        'http://127.0.0.2:5555',
        'runtime.example',
      ].map((origin) => isHttpsOrLoopback(origin)),
    ).toEqual([true, true, true, true, false, false, false]);
  });
});

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const modes: ReadonlyArray<readonly [string, AccessFacts, AccessMode | undefined]> = [
  ['nothing set, on a loopback address', { host: '127.0.0.1', apiKeys: undefined, signsIn: false }, 'local'],
  ['nothing set, on localhost', { host: 'localhost', apiKeys: undefined, signsIn: false }, 'local'],
  ['keys, on a loopback address', { host: '127.0.0.1', apiKeys: [entry], signsIn: false }, 'credentials'],
  ['sign-in, on any address', { host: '0.0.0.0', apiKeys: undefined, signsIn: true }, 'credentials'],
  ['a list of no keys, without sign-in', { host: '0.0.0.0', apiKeys: [], signsIn: false }, 'closed'],
  ['a list of no keys, beside sign-in', { host: '0.0.0.0', apiKeys: [], signsIn: true }, 'credentials'],
  ['nothing set, beyond loopback', { host: '0.0.0.0', apiKeys: undefined, signsIn: false }, undefined],
  [
    'local mode declared, beyond loopback',
    { host: '0.0.0.0', apiKeys: undefined, signsIn: false, accessMode: 'local' },
    'local',
  ],
  [
    'local mode declared beside keys',
    { host: '0.0.0.0', apiKeys: [entry], signsIn: false, accessMode: 'local' },
    'credentials',
  ],
  [
    'local mode declared beside sign-in',
    { host: '::', apiKeys: undefined, signsIn: true, accessMode: 'local' },
    'credentials',
  ],
];

describe('the access mode a server is in', () => {
  it.each(modes)('follows from %s', (_case, facts, mode) => {
    expect(accessModeOf(facts)).toBe(mode);
  });
});

describe('listensOnlyOnLoopback', () => {
  it('holds for the addresses only this computer reaches, and no other', () => {
    expect(
      ['127.0.0.1', '127.9.9.9', '::1', 'localhost', '0.0.0.0', '::', '10.0.0.1'].map((host) =>
        listensOnlyOnLoopback(host),
      ),
    ).toEqual([true, true, true, true, false, false, false]);
  });
});

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
