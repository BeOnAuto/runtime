import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { OwnKeyEventSchema } from './own-keys.ts';

describe('the facts of the keys the runtime keeps for itself', () => {
  recordedFactsBehaviour({
    schema: OwnKeyEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.46.0': [
        {
          type: 'own_key_kept',
          data: { purpose: 'retry_state', secret_id: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
          context: { at: '2026-10-29T10:00:00.000Z', by: 'runtime' },
        },
      ],
      '0.56.0': [
        {
          type: 'own_key_kept',
          data: { purpose: 'content_address', secret_id: '019a4f2e-5c1b-7d3a-8e6f-1a2b3c4d5e6f' },
          context: { at: '2026-11-01T10:00:00.000Z', by: 'runtime' },
        },
      ],
      '0.72.0': [
        {
          type: 'own_key_kept',
          data: { purpose: 'link_code', secret_id: '019aa7c1-3e5d-7f20-9b4a-6c8d0e2f4a6b' },
          context: { at: '2026-11-22T10:00:00.000Z', by: 'runtime' },
        },
      ],
    },
  });
});
