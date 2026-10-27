import type { LicenseEntitlement } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import { licenseFixture } from '../testing/license-fixture.ts';

describe('binding a signed license to the completed exchange', () => {
  it.each<Partial<LicenseEntitlement>>([
    { serial: 'entitlement-from-another-challenge' },
    { generation: 2 },
    { licenseId: 'another-license' },
    { issuedAt: 1000 },
    { issuedAt: 305_000 },
    { allocationIds: ['missing-capacity'] },
  ])('refuses a valid authority signature with a mismatched response: %j', async (changed) => {
    const f = await licenseFixture();
    const challenge = await f.challenge();
    const issued = await f.bundle(challenge, changed);
    f.respond(issued);
    await expect(f.protocol.complete(challenge, Math.max(5000, issued.license.issuedAt))).rejects.toThrow(
      'license_response_mismatch',
    );
  });

  it.each([
    { tokens: [''] },
    { tokens: ['a'.repeat(65_537)] },
    { tokens: ['same-token', 'same-token'] },
    { tokens: Array.from({ length: 65 }, (_, index) => `token-${index}`) },
  ])(
    'refuses an oversized, empty or repeated capacity token list',
    async ({ tokens }: { readonly tokens: readonly string[] }) => {
      const f = await licenseFixture();
      const challenge = await f.challenge();
      f.respond(await f.bundle(challenge, {}, tokens));
      await expect(f.protocol.complete(challenge, 5000)).rejects.toThrow('license_bundle_invalid');
    },
  );

  it('refuses a response without the required bundle fields', async () => {
    const f = await licenseFixture();
    f.respond({ status: 'issued' });
    await expect(f.protocol.complete(await f.challenge(), 5000)).rejects.toThrow(/Missing|Expected/u);
  });
});
