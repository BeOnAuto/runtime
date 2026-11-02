import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { ErasedMemoryFactSchema } from './erased-facts.ts';

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' };

const baseline: readonly (typeof ErasedMemoryFactSchema.Type)[] = [
  {
    type: 'memory_remembered',
    data: {
      version: 2,
      text: null,
      erased_at: '2026-10-30T12:00:00.000Z',
      tags: [],
      expires_at: '2027-10-29T10:00:00.000Z',
      replaces_version: 1,
      moved_from: { scope: 'organization', id: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b70' },
    },
    context: acted,
  },
  { type: 'memory_erased', data: { version: 2 }, context: { at: '2026-10-30T12:00:00.000Z', by: 'person:user_2ada' } },
];

describe('the facts of a memory whose text was erased', () => {
  recordedFactsBehaviour({
    schema: ErasedMemoryFactSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.56.0': baseline },
  });
});
