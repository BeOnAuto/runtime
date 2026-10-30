import { makeCatalog } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { playbookOperations } from '../index.ts';

describe('the playbook operations', () => {
  const catalog = makeCatalog(playbookOperations);

  it('make one catalog of five org operations', () => {
    expect(catalog.operationsIn('org').map(({ name, title }) => `${name}: ${title}`)).toEqual([
      'create_playbook: Create playbook',
      'list_playbooks: List playbooks',
      'get_playbook: Get playbook',
      'update_playbook: Update playbook',
      'retire_playbook: Retire playbook',
    ]);
    expect(catalog.operationsIn('playbook')).toEqual([]);
  });

  it('answer at five different routes', () => {
    const routes = catalog.operations.map(({ route }) => `${route.method} ${route.path}`);

    expect(routes).toEqual([
      'POST /playbooks',
      'GET /playbooks',
      'GET /playbooks/{playbook}',
      'PUT /playbooks/{playbook}',
      'POST /playbooks/{playbook}/retire',
    ]);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
