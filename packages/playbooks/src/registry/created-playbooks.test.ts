import { describe, expect, it } from 'vitest';

import { playbookCreatedOf } from './created-playbooks.ts';

const context = { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' };

const created = {
  playbook: 'alpha',
  name: 'Alpha',
  description: '',
  created_by: { id: 'acme-admin', name: 'acme-admin' },
};

describe('the playbook a record of an org creates', () => {
  it('is named by its creation, and by no other record or one without who created it and when', () => {
    expect([
      playbookCreatedOf({ type: 'playbook_created', data: created, context }),
      playbookCreatedOf({ type: 'playbook_retired', data: { playbook: 'alpha' }, context }),
      playbookCreatedOf({ type: 'playbook_created', data: 'not a fact', context }),
      playbookCreatedOf({ type: 'playbook_created', data: created }),
    ]).toEqual(['alpha', undefined, undefined, undefined]);
  });
});
