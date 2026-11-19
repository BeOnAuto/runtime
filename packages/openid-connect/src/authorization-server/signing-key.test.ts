import { describe, expect, it } from 'vitest';

import { keptSecretsInMemory } from '../testing/kept-secrets-in-memory.ts';
import type { SigningKeyRows } from './signing-key-rows.ts';
import { signingKeyOf } from './signing-key.ts';

function rowsInMemory(keptElsewhereFirst?: string): SigningKeyRows {
  const kept: { secretId?: string } = {};
  return {
    kept: (secretId) => {
      kept.secretId ??= keptElsewhereFirst ?? secretId;
      return Promise.resolve(kept.secretId === secretId);
    },
    replaced: (secretId, _at, lost) => {
      const replacing = kept.secretId === lost;
      if (replacing) {
        kept.secretId = secretId;
      }
      return Promise.resolve(replacing);
    },
    found: () => Promise.resolve(kept.secretId),
  };
}

describe('the key the authorization server signs ID Tokens with', () => {
  it('is made at the first start, sealed as a secret, and read again at every later start', async () => {
    const rows = rowsInMemory();
    const secrets = keptSecretsInMemory();

    const made = await signingKeyOf(rows, secrets);
    const again = await signingKeyOf(rows, secrets);

    expect(made).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
    expect(made.kid).not.toBe('');
    expect(again).toEqual(made);
    expect(secrets.kept()).toHaveLength(1);
  });

  it('is the one a server that started at the same moment kept first, its own sealed secret forgotten', async () => {
    const secrets = keptSecretsInMemory();
    const first = await signingKeyOf(rowsInMemory(), secrets);
    const winner = String(secrets.kept()[0]);

    const second = await signingKeyOf(rowsInMemory(winner), secrets);

    expect(second).toEqual(first);
    expect(secrets.kept()).toEqual([winner]);
  });

  it('is made anew where the secret it names is no longer kept, the one of two servers that replaced it first', async () => {
    const rows = rowsInMemory();
    const secrets = keptSecretsInMemory();
    const lost = await signingKeyOf(rows, secrets);
    await secrets.forget(String(await rows.found()));

    const [one, other] = await Promise.all([signingKeyOf(rows, secrets), signingKeyOf(rows, secrets)]);

    expect(one).toEqual(other);
    expect(one.kid).not.toBe(lost.kid);
    expect(secrets.kept()).toEqual([await rows.found()]);
  });
});
