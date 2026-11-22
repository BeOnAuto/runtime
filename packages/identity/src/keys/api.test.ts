import { parseEnv } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  type ApiKey,
  authenticatorFor,
  createApiKey,
  InvalidApiKeysError,
  type KeyGrant,
  readApiKeys,
} from '../index.ts';
import { principalIn } from '../testing/index.ts';

const grant: KeyGrant = { id: 'ci-1', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] };

const keyWithTheSecretBytes0To31 = 'abk_ci-1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

const sha256OfThatKey = '269ce89dc8b3c0eb7966560f76d53555a184aaaffe7514d545765bf14701fa6a';

async function admits(entries: readonly ApiKey[], presented: string): Promise<boolean> {
  const authenticator = authenticatorFor({ host: '0.0.0.0', apiKeys: entries });
  return principalIn(await authenticator.authenticate(presented, '/v1/orgs/acme/playbooks')) !== undefined;
}

describe('createApiKey', () => {
  it('creates a key of the form abk_<id>_<secret>, the secret being 32 random bytes as base64url', () => {
    const { key } = createApiKey(grant);

    expect(key).toMatch(/^abk_ci-1_[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.from(key.slice('abk_ci-1_'.length), 'base64url')).toHaveLength(32);
  });

  it('stores the grant and a digest of 64 hex characters, and never the key', () => {
    const { key, entry } = createApiKey(grant);
    const { sha256, ...stored } = entry;

    expect(stored).toEqual(grant);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(entry)).not.toContain(key.slice('abk_ci-1_'.length));
  });

  it('stores a digest that admits the key it created and no other key', async () => {
    const created = createApiKey(grant);
    const another = createApiKey(grant);

    expect([await admits([created.entry], created.key), await admits([created.entry], another.key)]).toEqual([
      true,
      false,
    ]);
  });

  it('creates a different key each time', () => {
    expect(createApiKey(grant).key).not.toBe(createApiKey(grant).key);
  });
});

describe('the digest of an API key', () => {
  it('is the SHA-256 of the whole key in hex, so an entry holding it admits the key', async () => {
    expect(await admits([{ ...grant, sha256: sha256OfThatKey }], keyWithTheSecretBytes0To31)).toBe(true);
  });
});

const { entry } = createApiKey({
  id: 'ci-1',
  org: 'acme_Corp-1',
  permissions: ['playbook:read'],
  playbooks: ['alpha'],
});

const everything: ApiKey = { ...entry, id: 'ci-2', org: 'acme', permissions: [], playbooks: '*' };

function errorFrom(value: string): unknown {
  try {
    readApiKeys({ API_KEYS: value });
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('readApiKeys', () => {
  it.each([undefined, '', ' ', '\n\t '])('is not configured when API_KEYS is %j', (value) => {
    expect(readApiKeys({ API_KEYS: value })).toBeUndefined();
  });

  it('decodes a compact JSON array of keys', () => {
    expect(readApiKeys({ API_KEYS: JSON.stringify([entry, everything]) })).toEqual([entry, everything]);
  });

  it('is configured with no keys at all when API_KEYS is an empty array', () => {
    expect(readApiKeys({ API_KEYS: '[]' })).toEqual([]);
  });

  it.each([
    ['text that is not JSON', '[{id:a}]', 'API_KEYS: Expected a valid JSON string'],
    ['a value that is not an array', '{}', 'API_KEYS: Expected array'],
    ['a key with an unknown field', JSON.stringify([{ ...entry, note: 'x' }]), 'API_KEYS[0].note'],
    ['a duplicate id', JSON.stringify([entry, entry]), 'API_KEYS: Key ids must be unique'],
    ['a malformed digest', JSON.stringify([{ ...entry, sha256: 'abc' }]), 'API_KEYS[0].sha256'],
    ['an id that breaks the grammar', JSON.stringify([{ ...entry, id: 'CI_1' }]), 'API_KEYS[0].id'],
    ['an org that breaks the grammar', JSON.stringify([{ ...entry, org: 'a b' }]), 'API_KEYS[0].org'],
    ['an unknown permission', JSON.stringify([{ ...entry, permissions: ['admin'] }]), 'API_KEYS[0].permissions[0]'],
    ['a playbook that breaks the grammar', JSON.stringify([{ ...entry, playbooks: ['B'] }]), 'API_KEYS[0].playbooks'],
    ['a missing field', JSON.stringify([{ id: 'ci-1' }]), 'API_KEYS[0].org: Missing key'],
  ])('rejects %s with a named error that points at it', (_case, value, mention) => {
    const error = errorFrom(value);

    expect(error).toBeInstanceOf(InvalidApiKeysError);
    expect(error).toMatchObject({ name: 'InvalidApiKeysError' });
    expect(String(error)).toContain(mention);
  });

  it('reads an unquoted compact JSON line from an env file unchanged, as the parser of --env-file reads it', () => {
    const line = JSON.stringify([entry, everything]);

    const { API_KEYS: read = '' } = parseEnv(`API_KEYS=${line}\n`);

    expect(read).toBe(line);
    expect(readApiKeys({ API_KEYS: read })).toEqual([entry, everything]);
  });
});

describe('the org reserved for local mode', () => {
  it('is refused in API_KEYS, naming the setting and not the value', () => {
    const error = errorFrom(JSON.stringify([{ ...entry, org: 'local' }]));

    expect(error).toBeInstanceOf(InvalidApiKeysError);
    expect(String(error)).toBe('InvalidApiKeysError: API_KEYS[0].org: This org id is reserved for local mode');
  });
});

describe('the key id the local developer is recorded under', () => {
  it('is refused in API_KEYS, so no key can act as the local developer on the facts', () => {
    const error = errorFrom(JSON.stringify([{ ...entry, id: 'local' }]));

    expect(error).toBeInstanceOf(InvalidApiKeysError);
    expect(String(error)).toBe('InvalidApiKeysError: API_KEYS[0].id: This key id is reserved for the local developer');
  });
});
