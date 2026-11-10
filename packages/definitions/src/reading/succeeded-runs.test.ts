import { memoryRecordedContent } from '@on.auto/content/testing';
import type { RecordedPage, RecordedPageRequest, RecordedSelection } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runStartCursorIn } from '../run-work/recorded-runs.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { succeededRunsPageOf, type SucceededRunsReader } from './succeeded-runs.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const alpha = { org: 'acme', playbook: 'alpha' };

const greet = { type: 'echo', name: 'greet' };

const latestRunId = '55555555-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function playbookWithRuns() {
  const operations = definitionOperationsFor([echo]);
  const definitions = harness();
  const creating = (name: string, greeting: string) =>
    definitions.call(
      operations.createDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name, source: JSON.stringify({ greeting }) }),
    );
  const running = (name: string, input: unknown, runId: string, at: string) =>
    definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { type: 'echo', name, input, run_id: runId }), at);
  await creating('greet', 'Hi');
  await creating('wave', 'Hey');
  await running('greet', { who: 'Ada' }, '11111111-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:01:00.000Z');
  await running('greet', ['not an object'], '22222222-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:02:00.000Z');
  await running('wave', { who: 'Grace' }, '33333333-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:03:00.000Z');
  await running('greet', { who: 'Linus' }, '44444444-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:04:00.000Z');
  await running('greet', { who: 'Barbara' }, latestRunId, '2026-10-01T09:05:00.000Z');
  const after = await Effect.runPromise(runStartCursorIn(definitions.ledger.service, { ...alpha, id: latestRunId }));
  return { ledger: definitions.ledger, after };
}

const linus = {
  run_id: '44444444-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definition_version: 1,
  started_at: '2026-10-01T09:04:00.000Z',
  finished_at: '2026-10-01T09:04:00.000Z',
  output: { inline: { greeting: 'Hi', input: { who: 'Linus' } } },
};

describe('a page of the runs of a definition that succeeded', () => {
  it('holds those started before the run it is read after, newest first, and the start of the oldest run it looked at', async () => {
    const { ledger, after } = await playbookWithRuns();

    expect(
      await Effect.runPromise(succeededRunsPageOf(ledger.service, { place: alpha, definition: greet, after })),
    ).toEqual({
      runs: [
        linus,
        {
          run_id: '11111111-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
          definition_version: 1,
          started_at: '2026-10-01T09:01:00.000Z',
          finished_at: '2026-10-01T09:01:00.000Z',
          output: { inline: { greeting: 'Hi', input: { who: 'Ada' } } },
        },
      ],
      reached: '2026-10-01T09:01:00.000Z',
    });
  });

  it('looks at no run started before since', async () => {
    const { ledger, after } = await playbookWithRuns();
    const since = '2026-10-01T09:02:00.000Z';

    expect(
      await Effect.runPromise(succeededRunsPageOf(ledger.service, { place: alpha, definition: greet, after, since })),
    ).toEqual({ runs: [linus], reached: since });
  });
});

describe('the read of a page of the runs of a definition that succeeded', () => {
  it('asks the ledger for the definition’s runs that succeeded after a place, newest first, loading only their ends', async () => {
    const asked: { selection?: RecordedSelection; page?: RecordedPageRequest } = {};
    const nextPage: RecordedPage = { records: [], hasMore: true, nextCursor: 'the-next-page', lastExamined: null };
    const reader: SucceededRunsReader = {
      readRecorded: (_, selection, page) =>
        Effect.sync(() => {
          asked.selection = selection;
          asked.page = page;
          return nextPage;
        }),
      content: memoryRecordedContent(),
    };

    expect(
      await Effect.runPromise(succeededRunsPageOf(reader, { place: alpha, definition: greet, after: 'this-page' })),
    ).toEqual({ runs: [], next: 'the-next-page' });
    expect(asked).toEqual({
      selection: { kind: 'runs', notBeginningWith: ['run_cancel_requested'], definitionType: 'echo', name: 'greet' },
      page: {
        order: 'desc',
        limit: 100,
        types: ['run_succeeded'],
        dataOf: ['run_succeeded'],
        cursor: 'this-page',
      },
    });
  });
});
