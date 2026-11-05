import { makeCatalog } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

describe('the playbook operations', () => {
  const catalog = makeCatalog(playbookOperations);

  it('make one catalog of six org operations', () => {
    expect(catalog.operationsIn('org').map(({ name, title }) => `${name}: ${title}`)).toEqual([
      'create_playbook: Create playbook',
      'list_playbooks: List playbooks',
      'get_playbook: Get playbook',
      'update_playbook: Update playbook',
      'retire_playbook: Retire playbook',
      'restore_playbook: Restore playbook',
    ]);
    expect(catalog.operationsIn('playbook')).toEqual([]);
  });

  it('answer at six different routes', () => {
    const routes = catalog.operations.map(({ route }) => `${route.method} ${route.path}`);

    expect(routes).toEqual([
      'POST /playbooks',
      'GET /playbooks',
      'GET /playbooks/{playbook}',
      'PUT /playbooks/{playbook}',
      'POST /playbooks/{playbook}/retire',
      'POST /playbooks/{playbook}/restore',
    ]);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
import { playbookOperations } from '../testing/playbook-pages.ts';
