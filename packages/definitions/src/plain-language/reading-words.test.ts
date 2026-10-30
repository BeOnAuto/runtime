import { describe, expect, it } from 'vitest';

import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';

const { listRuns } = definitionOperationsFor([echo]);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function run(status: string): Readonly<Record<string, unknown>> {
  return {
    run_id: runId,
    type: 'echo',
    name: 'greet',
    definition_version: 1,
    status,
    started_at: '2026-10-01T09:00:00.000Z',
    started_by: { id: 'acme-admin', name: 'acme-admin' },
  };
}

function listed(runs: readonly unknown[], filters: object = {}, hasMore = false): string | undefined {
  return listRuns.registration.plainLanguage?.outcome(
    { runs, has_more: hasMore, next_cursor: hasMore ? 'WyJicmFpbiJd' : null },
    filters,
  );
}

describe('the plain language of list_runs', () => {
  it('says how many runs it listed and how they ended', () => {
    expect([
      listed([run('started'), run('succeeded'), run('rejected')]),
      listed([run('failed'), run('failed')], { status: 'failed' }, true),
      listed([run('succeeded')], { name: 'greet' }),
      listed(
        Array.from({ length: 100 }, () => run('succeeded')),
        {},
        true,
      ),
    ]).toEqual([
      'Listed 3 runs, newest first: 1 still running, 1 finished, and 1 did not go through.',
      'Listed 2 runs that broke down, newest first. More remain after these.',
      'Listed 1 run of anything named “greet”, newest first: 1 finished.',
      'Listed one hundred runs, newest first: one hundred finished. More remain after these.',
    ]);
  });

  it('says there are none, none more, or none on this page with more to look through', () => {
    expect([
      listed([]),
      listed([], { type: 'echo' }),
      listed([], { cursor: 'WyJicmFpbiJd', status: 'started' }),
      listed([], { type: 'echo', name: 'greet', status: 'succeeded' }, true),
    ]).toEqual([
      'This playbook has no runs yet.',
      'This playbook has no runs of greetings.',
      'There are no more runs that are still running.',
      'This page holds no runs of the greeting “greet” that finished, but there are more runs to look through.',
    ]);
  });

  it('names the runs it tried to list', () => {
    expect([
      listRuns.registration.plainLanguage?.attempt({}),
      listRuns.registration.plainLanguage?.attempt({ type: 'echo', status: 'started' }),
      listRuns.registration.plainLanguage?.attempt({ status: 'sideways' }),
    ]).toEqual(['list the runs', 'list the runs of greetings that are still running', 'list the runs']);
  });
});
