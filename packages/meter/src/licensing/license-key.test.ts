import { describe, expect, it } from 'vitest';

import { isLicenseKey } from './license-key.ts';

describe('a license key of Studio', () => {
  it.each(['alk.acme.0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.c2VjcmV0', 'alk.globex.one.s3cr3t_-'])('is %s', (key) => {
    expect(isLicenseKey(key)).toBe(true);
  });

  it.each(['', 'alk.acme.one', 'ak_one_secret', 'alk.acme.one.two.three', 'alk.acme. .secret', 'xalk.acme.one.secret'])(
    'is not %j',
    (key) => {
      expect(isLicenseKey(key)).toBe(false);
    },
  );
});
