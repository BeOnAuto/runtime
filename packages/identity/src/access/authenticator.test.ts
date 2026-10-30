import { userInfo } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  authenticatorFor,
  createApiKey,
  defaultStudioOrigin,
  type ApiKey,
  type ApiKeySource,
  type IdentityService,
} from '../index.ts';
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

const adaOfAcme = { id: 'person:ada', name: 'Ada Lovelace', org: 'acme', permissions: [], playbooks: [] };

const signedInAda = { own: adaOfAcme, callerIn: () => adaOfAcme };

const adasAccount = { username: 'ada' };

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
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined, localAccount: () => adasAccount });
    const developer = principalIn(await authenticator.authenticate(undefined, anyPath));

    expect(developer?.callerIn('globex')).toEqual({
      id: 'local',
      name: 'ada',
      org: 'globex',
      permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'],
      playbooks: '*',
    });
    expect(authenticator.resource).toBeUndefined();
  });

  it('names the local developer by the account the server runs as on this computer', async () => {
    const developer = principalIn(
      await authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }).authenticate(undefined, anyPath),
    );

    expect(developer?.own.name).toBe(userInfo().username);
  });

  it.each([
    [
      'names no account',
      () => {
        throw new Error('ENOENT: no such file or directory, uv_os_get_passwd');
      },
    ],
    ['names an account without a name', () => ({ username: '' })],
  ])('names the local developer by its id where the computer %s', async (_case, localAccount) => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined, localAccount });

    expect(principalIn(await authenticator.authenticate(undefined, anyPath))?.own.name).toBe('local');
  });

  it('gives the local developer the org local as its own', async () => {
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined });
    const developer = principalIn(await authenticator.authenticate('a.token.of-ada', anyPath));

    expect(developer?.own.org).toBe('local');
  });
});

describe('authenticatorFor where its operator declares local mode', () => {
  it.each(otherHosts)('is in local mode on %s, admitting every request as the local developer', async (host) => {
    const authenticator = authenticatorFor({ host, apiKeys: undefined, accessMode: 'local' });
    const developer = principalIn(await authenticator.authenticate(undefined, anyPath));

    expect([authenticator.mode, developer?.own.org]).toEqual(['local', 'local']);
  });

  it('takes the credentials it is given over the declaration', () => {
    expect([
      authenticatorFor({ host: '0.0.0.0', apiKeys: keys, accessMode: 'local' }).mode,
      authenticatorFor({ host: '0.0.0.0', apiKeys: undefined, identityService, accessMode: 'local' }).mode,
    ]).toEqual(['credentials', 'credentials']);
  });
});

describe('authenticatorFor beyond loopback with neither sign-in nor API keys', () => {
  it.each(otherHosts)('stops start-up on %s with a named error that says what the server needs', (host) => {
    expect(() => authenticatorFor({ host, apiKeys: undefined })).toThrow(
      expect.objectContaining({
        name: 'ReachableWithoutCredentialsError',
        message: `A server reachable beyond this computer needs PUBLIC_URL, to sign people in, or API_KEYS, and this one listens on HOST ${host}; where only this computer reaches its port, ACCESS_MODE=local with a PUBLIC_URL on the loopback declares local mode instead`,
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

  it('admits a configured key as a caller of its own org, named by its id, and of no other', async () => {
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys });
    const holder = principalIn(await authenticator.authenticate(reader.key, anyPath));

    expect(holder?.callerIn('acme')).toEqual({
      id: 'acme-reader',
      name: 'acme-reader',
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

interface FakeKeySource extends ApiKeySource {
  readonly revoke: (id: string) => void;
  readonly asked: () => readonly string[];
}

function fakeKeySource(entries: readonly ApiKey[]): FakeKeySource {
  const held = new Map(entries.map((entry) => [entry.id, entry]));
  const asked: string[] = [];
  return {
    keyOf: (id) => {
      asked.push(id);
      return Promise.resolve(held.get(id));
    },
    revoke: (id) => {
      held.delete(id);
    },
    asked: () => [...asked],
  };
}

describe('authenticatorFor with a source of API keys', () => {
  it('admits a key the source answers, asking it for the id the key names', async () => {
    const source = fakeKeySource([reader.entry]);
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys, apiKeySource: source });

    expect(principalIn(await authenticator.authenticate(reader.key, anyPath))?.own.id).toBe('acme-reader');
    expect(source.asked()).toEqual(['acme-reader']);
  });

  it('refuses a key the source does not know, though the configured list holds it', async () => {
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys, apiKeySource: fakeKeySource([]) });

    expect(await authenticator.authenticate(admin.key, anyPath)).toEqual(unexplained);
  });

  it('refuses a key on the authenticator that admitted it, once the source answers nothing for it', async () => {
    const source = fakeKeySource(keys);
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys, apiKeySource: source });
    const beforeTheRevocation = principalIn(await authenticator.authenticate(admin.key, anyPath))?.own.id;
    source.revoke('acme-admin');

    expect([beforeTheRevocation, await authenticator.authenticate(admin.key, anyPath)]).toEqual([
      'acme-admin',
      unexplained,
    ]);
    expect(principalIn(await authenticator.authenticate(reader.key, anyPath))?.own.id).toBe('acme-reader');
  });

  it('asks the source nothing for a credential that is not a key, and refuses it', async () => {
    const source = fakeKeySource(keys);
    const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: keys, apiKeySource: source });

    expect(await authenticator.authenticate('abk_not-a-key', anyPath)).toEqual(unexplained);
    expect(source.asked()).toEqual([]);
  });

  it('asks the source nothing in local mode or once closed, where no key is checked', async () => {
    const source = fakeKeySource(keys);
    const local = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined, apiKeySource: source });
    const closed = authenticatorFor({ host: '0.0.0.0', apiKeys: [], apiKeySource: source });

    expect(principalIn(await local.authenticate(admin.key, anyPath))?.own.id).toBe('local');
    expect(await closed.authenticate(admin.key, anyPath)).toEqual(unexplained);
    expect(source.asked()).toEqual([]);
  });
});
