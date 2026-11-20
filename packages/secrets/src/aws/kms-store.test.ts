import { randomUUID } from 'node:crypto';

import { Effect } from 'effect';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { serveFakeKms } from '../fakes/fake-kms.ts';
import { inMemoryEntry, type TestCustodians } from '../testing/secrets-entry.ts';
import { storeBehaviour } from '../testing/store-behaviour.ts';
import { kmsCustodian } from './kms-custodian.ts';

const keys = Array.from({ length: 3 }, () => `arn:aws:kms:eu-west-1:111122223333:key/${randomUUID()}`);

const fake = await serveFakeKms({ keys });

afterAll(fake.close);

const made = { custodians: 0 };

const onTheFake: TestCustodians = {
  aCustodian: () => {
    made.custodians += 1;
    return Effect.runPromise(
      kmsCustodian({
        keyId: String(keys[made.custodians % keys.length]),
        region: 'eu-west-1',
        proxy: { enabled: false, environment: {} },
        credentials: { accessKeyId: 'an-access-key', secretAccessKey: 'a-secret-access-key' },
        endpoint: fake.url,
      }),
    );
  },
};

describe('the secret store over keys in KMS, each data key wrapped by Encrypt and unwrapped by Decrypt', () => {
  const warned = vi.spyOn(console, 'warn');

  storeBehaviour(inMemoryEntry(), onTheFake);

  it('writes nothing to console.warn from the SDK while it wraps and unwraps', () => {
    expect(fake.calls().map(({ operation }) => operation)).toEqual(expect.arrayContaining(['Encrypt', 'Decrypt']));
    expect(warned).not.toHaveBeenCalled();
  });
});
