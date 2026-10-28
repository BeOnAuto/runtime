import type { LicenseStatus } from '@on.auto/meter';
import { describe, expect, it } from 'vitest';

import { licenseNoticeOf, offlineCreditsNotice } from './license-notice.ts';

const unregistered: LicenseStatus = {
  state: 'unregistered',
  runtime_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  free_runs: { used: 12, of: 100 },
  org: null,
  plan: null,
  expires_at: null,
  renewed_at: null,
  key_source: null,
  offline: null,
  invalid_because: null,
};

const offline = { credits: 50, spent: 7, usable_until: '2026-11-03T12:00:00.000Z' };

describe('the line that says what a runtime holds', () => {
  it('counts the free runs it used while it is unregistered, and names who it is licensed to once it is', () => {
    expect([
      licenseNoticeOf(unregistered),
      licenseNoticeOf({ ...unregistered, state: 'licensed', org: 'acme', plan: 'team', key_source: 'environment' }),
    ]).toEqual(['12 of 100 free runs used, then a free key from Studio', 'Licensed to acme (team plan)']);
  });

  it('counts the offline credits it spent, and until when it may spend them', () => {
    expect(licenseNoticeOf({ ...unregistered, state: 'offline', offline })).toBe(
      'Offline credits: 7 of 50 used, usable until 2026-11-03',
    );
    expect(offlineCreditsNotice(offline)).toBe('Offline credits: 7 of 50 used, usable until 2026-11-03');
  });

  it('says nothing of a license that does not stand', () => {
    expect(licenseNoticeOf({ ...unregistered, state: 'invalid', invalid_because: 'It was removed' })).toBeUndefined();
  });
});
