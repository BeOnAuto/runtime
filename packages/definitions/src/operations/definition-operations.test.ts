import { makeCatalog } from '@on.auto/operations';
import { playbookOperationsOf } from '@on.auto/playbooks';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionOperations } from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { runContentHolders } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';

const operations = makeDefinitionOperations([echo, probe().capability], uncheckedPages, { holders: runContentHolders });

const catalog = makeCatalog(operations);

const playbookOperations = playbookOperationsOf({ pageOf: () => Effect.undefined, save: () => Effect.undefined });

describe('the definition operations', () => {
  it('make one catalog of sixteen playbook operations', () => {
    expect(catalog.operationsIn('playbook').map(({ name, title }) => `${name}: ${title}`)).toEqual([
      'create_definition: Create definition',
      'list_definitions: List definitions',
      'get_definition: Get definition',
      'render_page: Render page',
      'render_playbook_page: Render playbook page',
      'update_definition: Update definition',
      'pause_definition: Pause definition',
      'resume_definition: Resume definition',
      'retire_definition: Retire definition',
      'restore_definition: Restore definition',
      'run_definition: Run definition',
      'get_run: Get run',
      'cancel_run: Cancel run',
      'list_runs: List runs',
      'get_run_history: Get run history',
      'get_playbook_analytics: Get playbook analytics',
    ]);
    expect(catalog.operationsIn('org')).toEqual([]);
  });

  it('answer at sixteen routes relative to the playbook', () => {
    expect(catalog.operations.map(({ route }) => `${route.method} ${route.path}`)).toEqual([
      'POST /definitions/{type}',
      'GET /definitions/{type}',
      'GET /definitions/{type}/{name}',
      'POST /definitions/{type}/{name}/render',
      'POST /render',
      'PUT /definitions/{type}/{name}',
      'POST /definitions/{type}/{name}/pause',
      'POST /definitions/{type}/{name}/resume',
      'POST /definitions/{type}/{name}/retire',
      'POST /definitions/{type}/{name}/restore',
      'POST /definitions/{type}/{name}/run',
      'GET /runs/{run_id}',
      'POST /runs/{run_id}/cancel',
      'GET /runs',
      'GET /runs/{run_id}/history',
      'GET /analytics',
    ]);
  });
});

describe('a catalog of the definition operations', () => {
  it('takes the playbook operations as well, without a clash of names or routes', () => {
    expect(makeCatalog([...playbookOperations, ...operations]).operations.map(({ name }) => name)).toEqual([
      'create_playbook',
      'list_playbooks',
      'get_playbook',
      'update_playbook',
      'retire_playbook',
      'restore_playbook',
      'create_definition',
      'list_definitions',
      'get_definition',
      'render_page',
      'render_playbook_page',
      'update_definition',
      'pause_definition',
      'resume_definition',
      'retire_definition',
      'restore_definition',
      'run_definition',
      'get_run',
      'cancel_run',
      'list_runs',
      'get_run_history',
      'get_playbook_analytics',
    ]);
  });
});

describe('the definition operations for a list of capabilities', () => {
  it('need at least one capability', () => {
    expect(() => makeDefinitionOperations([], uncheckedPages, { holders: runContentHolders })).toThrow(
      'The definition operations need at least one capability',
    );
  });

  it('need capabilities of distinct names', () => {
    expect(() =>
      makeDefinitionOperations([echo, probe().capability, { ...echo, title: 'Another echo' }], uncheckedPages, {
        holders: runContentHolders,
      }),
    ).toThrow('The type echo is used more than once');
  });
});
