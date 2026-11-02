import { describe, expect, it } from 'vitest';

import type { KeptViewState } from '../capability/view-standing.ts';
import { playbookWithTheWorkflow } from '../testing/page-playbooks.ts';
import { keepingTheViews } from '../testing/page-ports.ts';
import { latelyOfTheDays, pageData, pageOf } from '../testing/pages.ts';

const greetingPage = pageOf({
  body: '{% result %}\n{{ output.greeting }} from version {{ run.version }}\n{% endresult %}',
});

const daysPage = pageOf({
  body: '{% result %}{{ output.greeting }}{% endresult %}\n{% lately %}\n{{ views.by_day.lines[0].points | size }} days\n{% endlately %}',
  data: pageData(),
});

const liveDays: KeptViewState = {
  version: 1,
  phase: 'live',
  view: { by_day: { period: 'day', lines: [{ name: 'Posts', points: [{ at: '2026-10-31', value: 3 }] }] } },
  checkpoint: 'cursor',
  checkpointAt: '2026-11-01T09:00:00.000Z',
  lastEvent: null,
  folded: 1,
};

function runIdOf(outcome: { readonly status: string; readonly output?: unknown }): string {
  return String(Reflect.get(new Object(outcome.output), 'run_id'));
}

const latelyOnly = pageOf({ body: latelyOfTheDays, data: pageData() });

describe('get_run of a run whose definition has a page', () => {
  it('carries the run as the page shows it, as page.result', async () => {
    const { saving, running, readingRun, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: greetingPage });
    const ran = await running({ type: 'workflow', name: 'morning-social-content', input: {} });

    expect(await readingRun({ run_id: runIdOf(ran) })).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', page: { result: 'Good morning from version 1' } },
    });
  });

  it('carries no page for a definition without one, nor for a page without result', async () => {
    const { saving, running, readingRun, ready } = playbookWithTheWorkflow();
    await ready;
    const ran = await running({ type: 'workflow', name: 'morning-social-content', input: {} });
    const without = await readingRun({ run_id: runIdOf(ran) });
    await saving({ type: 'page', name: 'morning-posts', source: latelyOnly });

    expect(without).not.toHaveProperty('output.page');
    expect(await readingRun({ run_id: runIdOf(ran) })).not.toHaveProperty('output.page');
  });
});

describe('get_definition of a subject that has a page', () => {
  it('carries what the page shows of its runs so far, as page.lately', async () => {
    const { saving, reading, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays));
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: daysPage });

    expect(await reading({ type: 'workflow', name: 'morning-social-content' })).toMatchObject({
      status: 'succeeded',
      output: { page: { lately: '1 days' } },
    });
  });

  it('says the figures are being worked out while the views are built, and carries nothing for a page without lately', async () => {
    const { saving, reading, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: daysPage });
    const building = await reading({ type: 'workflow', name: 'morning-social-content' });
    await saving({ type: 'reasoning', name: 'review-brief', source: '{"greeting": "Hi"}', diagram: 'none' });
    await saving({ type: 'page', name: 'reviews', source: pageOf({ of: 'reasoning/review-brief' }) });

    expect(building).toMatchObject({
      output: { page: { lately: "The figures on this page are being worked out from the playbook's history." } },
    });
    expect(await reading({ type: 'reasoning', name: 'review-brief' })).not.toHaveProperty('output.page');
  });
});

describe('views that stopped', () => {
  it('show the one line that says so', async () => {
    const { saving, reading, ready } = playbookWithTheWorkflow(keepingTheViews({ ...liveDays, phase: 'stalled' }));
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: latelyOnly });

    expect(await reading({ type: 'workflow', name: 'morning-social-content' })).toMatchObject({
      output: {
        page: {
          lately: 'The figures on this page stopped at an event they could not take, and wait for a corrected page.',
        },
      },
    });
  });
});

describe('the preview of a page', () => {
  it('renders result over the subject’s latest run, or none before it has run, and lately', async () => {
    const { saving, reading, running, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays));
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: daysPage });
    const before = await reading({ type: 'page', name: 'morning-posts', render: true });
    await running({ type: 'workflow', name: 'morning-social-content', input: {} });

    expect(before).toMatchObject({ status: 'succeeded', output: { page: { lately: '1 days' } } });
    expect(before).not.toHaveProperty('output.page.result');
    expect(await reading({ type: 'page', name: 'morning-posts', render: true })).toMatchObject({
      output: { page: { result: 'Good morning', lately: '1 days' } },
    });
  });

  it('shows nothing of a page whose subject has not run and that has no lately', async () => {
    const { saving, reading, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: greetingPage });

    expect(await reading({ type: 'page', name: 'morning-posts', render: true })).not.toHaveProperty('output.page');
  });
});

describe('the preview of a page over a sample', () => {
  it('renders result over a sample output, checked against the subject’s output schema', async () => {
    const { saving, reading, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: greetingPage });
    const sample = { greeting: 'Good morning', input: {} };

    expect(await reading({ type: 'page', name: 'morning-posts', render: true, sample_output: sample })).toMatchObject({
      output: { page: { result: 'Good morning from version 1' } },
    });
    expect(
      await reading({
        type: 'page',
        name: 'morning-posts',
        render: true,
        sample_output: { greeting: 'Hi', input: {} },
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The sample output does not match the output schema of the page’s subject',
      issues: [{ pointer: '/sample_output/greeting' }],
    });
  });
});

describe('the preview of the playbook’s page', () => {
  it('is the one way to read the playbook’s page, whose subject is the playbook', async () => {
    const { saving, rendering, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays));
    await ready;
    const playbookPage = pageOf({
      of: 'playbook',
      body: '{% lately %}{{ subject.type }} {{ subject.name }} {{ subject.version | default: "unversioned" }}{% endlately %}',
      data: pageData(),
    });
    await saving({ type: 'page', name: 'playbook-page', source: playbookPage });

    expect(await rendering({ name: 'playbook-page' })).toMatchObject({
      status: 'succeeded',
      output: { type: 'page', name: 'playbook-page', page: { lately: 'playbook alpha unversioned' } },
    });
  });
});

describe('a preview that is refused', () => {
  it('is refused for a retired page, and for render or sample_output where they do not apply', async () => {
    const { saving, reading, retiring, rendering, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: greetingPage });
    await retiring({ type: 'page', name: 'morning-posts' });

    expect(await rendering({ name: 'morning-posts' })).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(await reading({ type: 'workflow', name: 'morning-social-content', render: true })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/render' }],
    });
    expect(await reading({ type: 'page', name: 'morning-posts', sample_output: {} })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/sample_output',
          detail: 'sample_output is read only with render: true; add render: true, or leave sample_output out',
        },
      ],
    });
    expect(await reading({ type: 'page', name: 'morning-posts' })).not.toHaveProperty('output.page');
  });
});
