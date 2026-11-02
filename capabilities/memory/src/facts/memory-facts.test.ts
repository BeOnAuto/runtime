import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { KeptMemoryFactSchema } from './memory-facts.ts';

const ofTheRun = {
  at: '2026-10-29T10:00:00.000Z',
  by: 'key_7f3a',
  runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'memory',
  definitionName: 'keep-decisions',
  definitionVersion: 2,
};

const acted = { at: '2026-10-29T11:00:00.000Z', by: 'person:user_2ada' };

const baseline: readonly (typeof KeptMemoryFactSchema.Type)[] = [
  {
    type: 'memory_remembered',
    data: {
      version: 2,
      text: 'The team ships on Thursdays',
      tags: ['releases', 'team'],
      about: { from: '2026-10-01', to: '2026-12-31' },
      expires_at: '2027-10-29T10:00:00.000Z',
      replaces_version: 1,
      moved_from: { scope: 'playbook', playbook: 'alpha', id: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b70' },
    },
    context: ofTheRun,
  },
  { type: 'memory_forgotten', data: { version: 2 }, context: acted },
  {
    type: 'memory_moved',
    data: { to: 'playbook', as: '1f0e2d3c-4b5a-5968-8776-a5b4c3d2e1f0', playbook: 'alpha' },
    context: acted,
  },
];

describe('the facts of the memories a playbook or an organization keeps', () => {
  recordedFactsBehaviour({
    schema: KeptMemoryFactSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.56.0': baseline },
  });
});
