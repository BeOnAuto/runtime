import { describe, expect, it } from 'vitest';

import { authenticatorFor, createApiKey, type ApiKey, type KeyGrant } from '../index.ts';
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
