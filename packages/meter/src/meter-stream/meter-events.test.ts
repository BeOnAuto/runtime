import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { MeterEventSchema } from './meter-events.ts';

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'runtime' };

const signed = { payload: 'eyJ2IjoyfQ', signature: 'c2lnbmVk', kid: 'auto-2026-10' };

const license = {
  installation: 'installation-1',
  org: 'org-1',
  org_name: 'Example Org',
  plan: 'team',
  policy: 'standard',
  issued_at: '2026-10-29T10:00:00.000Z',
  warn_at: '2026-11-26T10:00:00.000Z',
  limit_at: '2026-11-29T10:00:00.000Z',
  charged_through: 120,
  admits_through: 1000,
  standing: 'ok',
  credits: { available: 500, owed: 0, overage_cap: 100 },
  fallback: { per_day: 15, per_month: 75 },
  licensed_reported: 100,
  key_sha256: 'f0e1d2',
  license: signed,
} as const;

const baseline: readonly (typeof MeterEventSchema.Type)[] = [
  { type: 'installation_identified', data: { installation: 'installation-1' }, context: acted },
  {
    type: 'action_admitted',
    data: { run: 'run-1', until: '2026-10-29T10:10:00.000Z', basis: 'licensed' },
    context: acted,
  },
  { type: 'license_activated', data: license, context: acted },
  { type: 'license_renewed', data: { ...license, charged_through: 180 }, context: acted },
  {
    type: 'license_invalidated',
    data: { key_sha256: 'f0e1d2', detail: 'The key of the license was rotated', because: 'key_rotated' },
    context: acted,
  },
  { type: 'usage_reported', data: { actions: 140, licensed: 120 }, context: acted },
  {
    type: 'allocation_received',
    data: {
      id: 'allocation-1',
      installation: 'installation-1',
      credits: 200,
      issued_at: '2026-10-29T10:00:00.000Z',
      refresh_by: '2026-10-30T10:00:00.000Z',
      actions: 140,
      allocation: signed,
    },
    context: acted,
  },
  {
    type: 'allocation_refreshed',
    data: { id: 'allocation-1', refresh_by: '2026-10-31T10:00:00.000Z', allocation: signed },
    context: acted,
  },
  {
    type: 'allocation_withdrawn',
    data: { id: 'allocation-1', detail: 'The allocation was withdrawn' },
    context: acted,
  },
  {
    type: 'allocation_reported',
    data: {
      allocation: 'allocation-1',
      installation: 'installation-1',
      sequence: 3,
      spent: 40,
      at: '2026-10-29T12:00:00.000Z',
    },
    context: acted,
  },
];

describe('the facts of the meter and of the allocations of credits it holds', () => {
  recordedFactsBehaviour({
    schema: MeterEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline },
  });
});
