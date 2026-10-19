import { describe, expect, it } from 'vitest';

import { authenticatorFor, createApiKey, defaultStudioOrigin, type ApiKey, type IdentityService } from '../index.ts';
import { fakeIssuer, principalIn } from '../testing/index.ts';

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] });

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: ['org:read', 'org:write'], playbooks: '*' });

const keys: readonly ApiKey[] = [reader.entry, admin.entry];

const wrongSecret = `abk_acme-reader_${'A'.repeat(43)}`;

const loopbackHosts = ['127.0.0.1', '127.1.2.3', '127.255.255.255', '::1', '0:0:0:0:0:0:0:1', 'localhost'];

const otherHosts = [
  '0.0.0.0',
  '::',
  '10.0.0.1',
  '192.168.1.10',
  '128.0.0.1',
  'auto-runtime.example',
  'localhost.example.com',
  'localhost.evil',
];

const anyPath = '/v1/orgs/acme/playbooks';

const unexplained = { because: undefined };

const adaOfAcme = { id: 'person:ada', org: 'acme', permissions: [], playbooks: [] };

const signedInAda = { own: adaOfAcme, callerIn: () => adaOfAcme };

const tokensSeen: string[] = [];

const identityService: IdentityService = {
  resource: { publicUrl: 'https://runtime.example', authorizationServers: ['https://login.example'] },
  personOf: (token, path, origin = 'no origin') => {
    tokensSeen.push(`${token} at ${path} from ${origin}`);
    return Promise.resolve(token === 'a.token.of-ada' ? signedInAda : { because: 'ERR_JWS_INVALID' });
  },
};

describe('authenticatorFor on a loopback address with neither sign-in nor API keys', () => {
  it.each(loopbackHosts)('is in local mode on the loopback address %s', (host) => {
    expect(authenticatorFor({ host, apiKeys: undefined }).mode).toBe('local');
  });

  it('admits every request in local mode as the local developer of whichever org it names', async () => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined });
    const developer = principalIn(await authenticator.authenticate(undefined, anyPath));

    expect(developer?.callerIn('globex')).toEqual({
      id: 'local',
      org: 'globex',
      permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'],
      playbooks: '*',
    });
    expect(authenticator.resource).toBeUndefined();
  });

  it('gives the local developer the org local as its own', async () => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined });
    const developer = principalIn(await authenticator.authenticate('a.token.of-ada', anyPath));

    expect(developer?.own.org).toBe('local');
  });
});

describe('authenticatorFor beyond loopback with neither sign-in nor API keys', () => {
  it.each(otherHosts)('stops start-up on %s with a named error that says what the server needs', (host) => {
    expect(() => authenticatorFor({ host, apiKeys: undefined })).toThrow(
      expect.objectContaining({
        name: 'ReachableWithoutCredentialsError',
        message: `A server reachable beyond this computer needs PUBLIC_URL, to sign people in, or API_KEYS, and this one listens on HOST ${host}`,
      }),
    );
  });
});

describe('authenticatorFor in local mode, with a credential presented', () => {
  it.each([
    [
      'the session a page signed in to Auto sends',
      () => fakeIssuer('https://login.example').session(defaultStudioOrigin),
    ],
    ['a key, where no key is set', () => Promise.resolve(admin.key)],
    ['a key that is not valid', () => Promise.resolve(wrongSecret)],
  ])('ignores %s and admits the request as the local developer', async (_case, presented) => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined });
    const developer = principalIn(await authenticator.authenticate(await presented(), anyPath));

    expect(developer?.callerIn('acme')).toMatchObject({ id: 'local', org: 'acme', playbooks: '*' });
  });
});

describe('authenticatorFor with API keys', () => {
  it.each([...loopbackHosts, ...otherHosts])('enforces the keys on %s', async (host) => {
    const authenticator = authenticatorFor({ host, apiKeys: keys });

    expect(authenticator.mode).toBe('credentials');
    expect(await authenticator.authenticate(undefined, anyPath)).toEqual(unexplained);
  });

  it('admits a configured key as a caller of its own org, and of no other', async () => {
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys });
    const holder = principalIn(await authenticator.authenticate(reader.key, anyPath));

    expect(holder?.callerIn('acme')).toEqual({
      id: 'acme-reader',
      org: 'acme',
      permissions: ['playbook:read'],
      playbooks: ['alpha'],
    });
    expect(holder?.callerIn('globex')).toBeUndefined();
    expect(holder?.own).toEqual(holder?.callerIn('acme'));
  });

  it.each([
    ['no key', undefined],
    ['a wrong secret', wrongSecret],
    ['an unknown id', admin.key.replace('acme-admin', 'acme-other')],
    ['a malformed key', 'not-a-key'],
    ['the digest itself', reader.entry.sha256],
  ])('rejects %s', async (_case, presentedKey) => {
    expect(await authenticatorFor({ host: '0.0.0.0', apiKeys: keys }).authenticate(presentedKey, anyPath)).toEqual(
      unexplained,
    );
  });

  it.each([...loopbackHosts, ...otherHosts])(
    'is closed on %s when the configured list is empty, and admits nobody, whatever key is presented',
    async (host) => {
      const authenticator = authenticatorFor({ host, apiKeys: [] });

      expect(authenticator.mode).toBe('closed');
      expect([
        await authenticator.authenticate(undefined, anyPath),
        await authenticator.authenticate(reader.key, anyPath),
      ]).toEqual([unexplained, unexplained]);
    },
  );
});

describe('authenticatorFor with the identity service', () => {
  it.each<readonly ApiKey[] | undefined>([undefined, []])(
    'checks credentials on loopback with API keys %j, and names the protected resource',
    (apiKeys) => {
      const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys, identityService });

      expect(authenticator.mode).toBe('credentials');
      expect(authenticator.resource).toEqual(identityService.resource);
    },
  );

  it('checks credentials beyond loopback without API keys', () => {
    expect(authenticatorFor({ host: '0.0.0.0', apiKeys: undefined, identityService }).mode).toBe('credentials');
  });

  it('asks the identity service about a token that is not a key, with the path and the origin of the request', async () => {
    tokensSeen.length = 0;
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys, identityService });

    expect(await authenticator.authenticate('a.token.of-ada', '/mcp', defaultStudioOrigin)).toBe(signedInAda);
    expect(await authenticator.authenticate('an.opaque.token', '/mcp')).toEqual({ because: 'ERR_JWS_INVALID' });
    expect(tokensSeen).toEqual([
      'a.token.of-ada at /mcp from https://studio.on.auto',
      'an.opaque.token at /mcp from no origin',
    ]);
  });

  it('verifies a key as a key, never as a token', async () => {
    tokensSeen.length = 0;
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys, identityService });

    expect(principalIn(await authenticator.authenticate(admin.key, anyPath))?.own.id).toBe('acme-admin');
    expect(await authenticator.authenticate(wrongSecret, anyPath)).toEqual(unexplained);
    expect(tokensSeen).toEqual([]);
  });
});
