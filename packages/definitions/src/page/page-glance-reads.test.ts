import { describe, expect, it } from 'vitest';

import type { KeptViewState } from '../capability/view-standing.ts';
import {
  foldingNothing,
  playbookWithTheWorkflow,
  runsOfTheDays,
  workflowWithItsPage,
} from '../testing/page-playbooks.ts';
import { keepingTheViews } from '../testing/page-ports.ts';

const workflow = { type: 'workflow', name: 'morning-social-content' };

const liveDays: KeptViewState = {
  version: 2,
  phase: 'live',
  view: { by_day: { period: 'day', lines: [{ name: 'Posts', points: [{ at: '2026-10-31', value: 3 }] }] } },
  checkpoint: 'cursor',
  checkpointAt: '2026-11-01T09:00:00.000Z',
  lastEvent: null,
  folded: 1,
};

function glanceOver(glance: string): string {
  return workflowWithItsPage(`${foldingNothing}\n${runsOfTheDays}\nglance:\n${glance}`);
}

describe('the glance of a workflow', () => {
  const counting = glanceOver(
    [
      "  headline: '{{ output.greeting }}'",
      "  days: '{{ views.by_day.lines[0].points | size }}'",
      "  ran: '{{ run.status }}'",
      '  outstanding: []',
    ].join('\n'),
  );

  it('renders over its views and its latest ended run, as page.glance, beside page.runs', async () => {
    const { updating, reading, running, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays));
    await ready;
    await updating({ ...workflow, source: counting });

    expect(await reading(workflow)).toMatchObject({
      output: { page: { runs: '1 days', glance: { headline: '', days: 1, ran: '', outstanding: [] } } },
    });
    await running({ ...workflow, input: {} });
    expect(await reading(workflow)).toMatchObject({
      output: { page: { glance: { headline: 'Good morning', days: 1, ran: 'succeeded' } } },
    });
  });

  it('reads the latest ended run alone on a page without views', async () => {
    const { updating, reading, running, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: workflowWithItsPage("glance:\n  headline: '{{ output.greeting }}'") });
    await running({ ...workflow, input: {} });
    expect(await reading(workflow)).toMatchObject({ output: { page: { glance: { headline: 'Good morning' } } } });
  });

  it('reads no views while they are built, and has none where a template stops', async () => {
    const building = playbookWithTheWorkflow();
    await building.ready;
    await building.updating({ ...workflow, source: counting });
    expect(await building.reading(workflow)).toMatchObject({ output: { page: { glance: { days: 0 } } } });

    const stopping = playbookWithTheWorkflow(keepingTheViews(liveDays));
    await stopping.ready;
    await stopping.updating({ ...workflow, source: glanceOver('  headline: \'{{ "dollars" | money }}\'') });
    expect(await stopping.reading(workflow)).not.toHaveProperty('output.page.glance');
  });
});
