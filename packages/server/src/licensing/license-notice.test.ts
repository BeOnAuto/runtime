import { describe, expect, it } from 'vitest';

import { offlineCreditsNotice } from './license-notice.ts';

describe('the line that says what offline credits a runtime holds', () => {
  it('counts the offline credits it spent, and until which day it may spend them', () => {
    expect(offlineCreditsNotice({ credits: 50, spent: 7, usable_until: '2026-11-26T12:00:00.000Z' })).toBe(
      'This runtime uses offline credits: 7 of 50 used, usable until 2026-11-26',
    );
  });
});
