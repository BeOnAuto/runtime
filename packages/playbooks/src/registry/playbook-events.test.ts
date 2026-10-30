import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { PlaybookEventSchema } from './playbook-events.ts';

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' };

const caller = { id: 'key_7f3a', name: 'key_7f3a' };

const baseline: readonly (typeof PlaybookEventSchema.Type)[] = [
  {
    type: 'playbook_created',
    data: { playbook: 'sales', name: 'Sales', description: 'Leads, quotes and orders', created_by: caller },
    context: acted,
  },
  { type: 'playbook_updated', data: { playbook: 'sales', description: 'Leads and orders' }, context: acted },
  { type: 'playbook_retired', data: { playbook: 'sales' }, context: acted },
];

describe('the facts of the registry of playbooks', () => {
  recordedFactsBehaviour({
    schema: PlaybookEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline },
  });
});
