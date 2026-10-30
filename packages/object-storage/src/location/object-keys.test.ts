import { describe, expect, it } from 'vitest';

import { objectKeysOf } from './object-keys.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const sha256 = 'a'.repeat(64);

describe('the keys of the content on object storage', () => {
  it('keep a content under the playbook key of its playbook and its digest, and an upload under its id', () => {
    const keys = objectKeysOf({ bucket: 'playbook-content', prefix: 'production' });

    expect([keys.kept(alpha, sha256), keys.uploads, keys.upload('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a')]).toEqual([
      `production/playbook/acme/alpha/${sha256}`,
      'production/uploads/',
      'production/uploads/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    ]);
  });

  it('start at the root of the bucket without a prefix', () => {
    const keys = objectKeysOf({ bucket: 'playbook-content', prefix: '' });

    expect([keys.kept(alpha, sha256), keys.uploads]).toEqual([`playbook/acme/alpha/${sha256}`, 'uploads/']);
  });
});
