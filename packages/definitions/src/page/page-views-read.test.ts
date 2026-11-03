import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeptViewState, KeptViews } from '../capability/view-standing.ts';
import { playbookAsked } from '../testing/page-asking.ts';
import { keepingTheViews, pagesOver } from '../testing/page-ports.ts';
import { workflowWithData } from '../testing/pages.ts';
import type { PageContent } from './subject-pages.ts';

const live: KeptViewState = {
  version: 1,
  phase: 'live',
  view: { by_day: { unit: 'posts', period: 'day', lines: [] } },
  checkpoint: 'c',
  checkpointAt: '2026-11-01T09:00:00.000Z',
  lastEvent: null,
  folded: 1,
};

function movingOnAfterTheFirstRead(first: KeptViewState, after: KeptViewState): KeptViews {
  const reads = { made: 0 };
  const viewOf = () =>
    Effect.sync(() => {
      reads.made += 1;
      return reads.made === 1 ? first : after;
    });
  return { ...keepingTheViews(after), viewOf };
}

const building: unknown = expect.stringContaining('Building');

const pages = pagesOver(movingOnAfterTheFirstRead({ ...live, phase: 'rebuilding' }, live));

async function contentOf(source: string): Promise<PageContent> {
  const content = await Effect.runPromise(pages.check(source, 'workflow'));
  if (content === null || content === undefined) {
    throw new Error('The source has no page');
  }
  return content;
}

describe('the views of a page as a read shows them', () => {
  it('are read once, so its figures and their standing are of one moment though the views move on between reads', async () => {
    const asked = playbookAsked();
    await asked.created('workflow', 'morning', workflowWithData(), { page: await contentOf(workflowWithData()) });

    expect(await asked.ask(pages.viewsOf({ type: 'workflow', name: 'morning' }))).toMatchObject({
      output: { answer: { runs: building, standing: { state: 'rebuilding' } } },
    });
  });
});
