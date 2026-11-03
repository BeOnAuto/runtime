import type { Runnable } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeptViewState, KeptViews } from '../capability/view-standing.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toPlaybook } from '../testing/harness.ts';
import { playbookAsked } from '../testing/page-asking.ts';
import {
  foldingNothing,
  functionWithItsPage,
  greeting,
  latelyOfTheDays,
  pageOfTheDays,
  pageOperationsOver,
  playbookWithTheWorkflow,
  resultOfTheGreeting,
  workflowWithItsPage,
} from '../testing/page-playbooks.ts';
import { keepingNoViews, keepingTheViews } from '../testing/page-ports.ts';

const greetingPage = workflowWithItsPage(resultOfTheGreeting);

const daysPage = workflowWithItsPage(pageOfTheDays);

const latelyOnly = workflowWithItsPage(`${foldingNothing}\n${latelyOfTheDays}`);

const liveDays: KeptViewState = {
  version: 2,
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

const workflow = { type: 'workflow', name: 'morning-social-content' };

const review = { type: 'reasoning', name: 'review-brief' };

describe('get_run of a run whose definition has a page', () => {
  it('carries the run as the page shows it, as page.result', async () => {
    const { updating, running, readingRun, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: greetingPage });
    const ran = await running({ ...workflow, input: {} });

    expect(await readingRun({ run_id: runIdOf(ran) })).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', page: { result: 'Good morning from version 2' } },
    });
  });

  it('carries no page for a definition without one, nor for a page without result', async () => {
    const { updating, running, readingRun, ready } = playbookWithTheWorkflow();
    await ready;
    const ran = await running({ ...workflow, input: {} });
    const without = await readingRun({ run_id: runIdOf(ran) });
    await updating({ ...workflow, source: latelyOnly });

    expect(without).not.toHaveProperty('output.page');
    expect(await readingRun({ run_id: runIdOf(ran) })).not.toHaveProperty('output.page');
  });
});

describe('get_definition of a definition that has a page', () => {
  it('carries what the page shows of its runs so far, as page.lately, and how its views stand, and no source', async () => {
    const { updating, reading, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays));
    await ready;
    await updating({ ...workflow, source: daysPage });

    const read = await reading(workflow);

    expect(read).toMatchObject({
      status: 'succeeded',
      output: { version: 2, source: daysPage, page: { lately: '1 days', standing: { state: 'live', version: 2 } } },
    });
    expect(read).not.toHaveProperty('output.page.source');
    expect(read).not.toHaveProperty('output.page.version');
  });

  it('says the figures are being worked out while the views are built, and answers no page with nothing to show', async () => {
    const { saving, updating, reading, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: daysPage });
    const building = await reading(workflow);
    await saving({ ...review, source: functionWithItsPage(resultOfTheGreeting), diagram: 'none' });

    expect(building).toMatchObject({
      output: {
        page: {
          lately: "Building this page's figures from the playbook's history…",
          standing: { state: 'rebuilding', version: 2, folded: 0 },
        },
      },
    });
    expect(await reading(review)).not.toHaveProperty('output.page');
  });

  it('is not listed among the users of its definition, whose runs its views fold', async () => {
    const { updating, reading, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: daysPage });

    expect(await reading(workflow)).not.toHaveProperty('output.used_by');
  });
});

describe('views that stopped', () => {
  it('show the one line that says so', async () => {
    const { updating, reading, ready } = playbookWithTheWorkflow(keepingTheViews({ ...liveDays, phase: 'stalled' }));
    await ready;
    await updating({ ...workflow, source: latelyOnly });

    expect(await reading(workflow)).toMatchObject({
      output: {
        page: {
          lately:
            'The figures stopped updating because the page could not process an event. Correct the page to continue.',
        },
      },
    });
  });
});

describe('the preview of a page', () => {
  it('renders result over the latest run, or none before it has run, and lately', async () => {
    const { updating, reading, rendering, running, ready } = playbookWithTheWorkflow(keepingTheViews(liveDays));
    await ready;
    await updating({ ...workflow, source: daysPage });
    const before = await reading({ ...workflow, render: true });
    await running({ ...workflow, input: {} });

    expect(before).toMatchObject({ status: 'succeeded', output: { page: { lately: '1 days' } } });
    expect(before).not.toHaveProperty('output.page.result');
    expect(await reading({ ...workflow, render: true })).toMatchObject({
      output: { page: { result: 'Good morning', lately: '1 days' } },
    });
    expect(await rendering(workflow)).toMatchObject({
      status: 'succeeded',
      output: { type: 'workflow', name: 'morning-social-content', page: { result: 'Good morning', lately: '1 days' } },
    });
  });

  it('shows no page where the definition has not run and the page has no lately', async () => {
    const { updating, reading, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: greetingPage });

    expect(await reading({ ...workflow, render: true })).toMatchObject({ status: 'succeeded' });
    expect(await reading({ ...workflow, render: true })).not.toHaveProperty('output.page');
  });
});

describe('the preview of a page over a sample', () => {
  it('renders result over a sample output, checked against the output schema of the definition', async () => {
    const { updating, reading, rendering, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: greetingPage });
    const sample = { greeting: 'Good morning', input: {} };

    expect(await reading({ ...workflow, render: true, sample_output: sample })).toMatchObject({
      output: { page: { result: 'Good morning from version 2' } },
    });
    expect(await rendering({ ...workflow, sample_output: sample })).toMatchObject({
      output: { page: { result: 'Good morning from version 2' } },
    });
    expect(await reading({ ...workflow, render: true, sample_output: { greeting: 'Hi', input: {} } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/sample_output/greeting' }],
    });
  });
});

function playbookWithItsPage(views: KeptViews = keepingNoViews) {
  const asked = playbookAsked();
  const operations = pageOperationsOver(views);
  const toAlpha = toPlaybook('acme', 'alpha');
  const { pages } = operations;
  return {
    ...asked,
    operations,
    calling: (operation: { readonly registration: Runnable<'playbook'> }, input: object) =>
      asked.playbook.call(operation, toAlpha(acmeAdmin, input)),
    savingThePlaybookPage: (source: string) =>
      asked.ask(
        Effect.flatMap(pages.check(source, 'playbook'), (content) =>
          pages.savePlaybookPage(content === null || content === undefined ? null : { source, content }),
        ),
      ),
  };
}

const playbookPage = [
  foldingNothing,
  'lately: \'{{ subject.type }} {{ subject.name }} {{ subject.version | default: "unversioned" }}\'',
].join('\n');

describe('the playbook’s page', () => {
  it('renders over its views, its subject the playbook, with how its views stand', async () => {
    const { operations, calling, savingThePlaybookPage } = playbookWithItsPage(
      keepingTheViews({ ...liveDays, version: 1 }),
    );
    await savingThePlaybookPage(playbookPage);

    expect(await calling(operations.renderPlaybookPage, {})).toMatchObject({
      status: 'succeeded',
      output: {
        page: { lately: 'playbook alpha unversioned', standing: { state: 'live' } },
      },
    });
  });

  it('takes no input, and refuses any in its own words', async () => {
    const { operations, calling } = playbookWithItsPage();
    const detail = 'render_playbook_page takes no input; send no body, or an empty object';

    expect(await calling(operations.renderPlaybookPage, { version: 2 })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ pointer: '/version', detail }],
    });
  });

  it('is refused as not found where the playbook has none', async () => {
    const { operations, calling } = playbookWithItsPage();

    expect(await calling(operations.renderPlaybookPage, {})).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'The playbook has no page; save one with update_playbook',
    });
  });
});

describe('a preview that is refused', () => {
  it('is refused for a retired definition, a definition without a page, and sample_output without render', async () => {
    const { saving, updating, reading, retiring, rendering, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ ...review, source: functionWithItsPage(resultOfTheGreeting), diagram: 'none' });
    await retiring(review);
    const noPageToRender =
      'The workflow morning-social-content has no page to render; save one with update_definition, or leave render out';

    expect(await rendering(review)).toEqual({
      status: 'rejected',
      reason: 'conflict',
      kind: 'retired',
      detail: 'The reasoning function review-brief is retired, and its page renders nowhere',
    });
    expect(await reading({ ...workflow, render: true })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: noPageToRender,
      issues: [{ pointer: '/render', detail: noPageToRender }],
    });
    expect(await rendering(workflow)).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'The workflow morning-social-content has no page; save one with update_definition',
    });
    await updating({ ...workflow, source: greetingPage });
    expect(await reading({ ...workflow, sample_output: {} })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/sample_output',
          detail: 'sample_output is read only with render: true; add render: true, or leave sample_output out',
        },
      ],
    });
  });
});

describe('a page saved as a definition of its own', () => {
  it('is the page of its subject until the document of the subject has a page of its own', async () => {
    const { operations, calling, created } = playbookWithItsPage();
    const legacy = '---\nof: workflow/morning-social-content\n---\n{% result %}{{ output.greeting }}!{% endresult %}\n';
    await calling(operations.createDefinition, { ...workflow, source: greeting });
    await created('page', 'morning-posts', legacy, { details: { of: 'workflow/morning-social-content' } });
    const sample = { greeting: 'Good morning', input: {} };

    const carried = await calling(operations.getDefinition, { ...workflow, render: true, sample_output: sample });
    await calling(operations.updateDefinition, { ...workflow, source: greetingPage });

    expect(carried).toMatchObject({ output: { page: { result: 'Good morning!' } } });
    expect(await calling(operations.getDefinition, { ...workflow, render: true, sample_output: sample })).toMatchObject(
      { output: { page: { result: 'Good morning from version 2' } } },
    );
  });
});
