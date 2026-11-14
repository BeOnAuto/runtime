import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { ImportEventSchema } from './import-facts.ts';

const ofThePlaybook = { at: '2026-11-09T10:00:00.000Z', by: 'key_7f3a' };

const mark = {
  import_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  digest: '5b496d32c3126262e44ef63452e0bb023027054e10572bc244160d1b53af3345',
};

describe('the facts of an import of a playbook', () => {
  recordedFactsBehaviour({
    schema: ImportEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.57.0': [
        { type: 'playbook_import_started', data: mark, context: ofThePlaybook },
        { type: 'playbook_imported', data: mark, context: ofThePlaybook },
      ],
    },
  });
});
