import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { LicenseKeyEventSchema } from './kept-license-key.ts';

describe('the facts of the license key the runtime keeps', () => {
  recordedFactsBehaviour({
    schema: LicenseKeyEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.46.0': [
        {
          type: 'license_key_kept',
          data: { secret_id: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
          context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
        },
      ],
    },
  });
});
