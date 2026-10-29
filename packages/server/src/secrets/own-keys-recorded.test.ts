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
    },
  });
});
