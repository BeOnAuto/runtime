import { Effect, Struct, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeptViewState, KeptViews } from '../capability/view-standing.ts';
import type { RunDetailAsRecorded } from '../runs/run.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { playbookAsked } from '../testing/page-asking.ts';
import {
  functionWithPage,
  runsOfTheDayChart,
  pageData,
  pageMappingOf,
  workflowWithData,
  workflowWithPage,
} from '../testing/pages.ts';
import { subjectPagesOf, type PageContent } from './subject-pages.ts';

const strippingTheModule = {
  check: () =>
    Promise.resolve({
      ran: 'checked' as const,
      issues: [],
      stripped: { module: 'stripped', expressions: [] },
      milliseconds: 0,
    }),
};

const playbookPage = pageMappingOf({ data: pageData(), runs: runsOfTheDayChart });

function keeping(kept: Readonly<Record<string, KeptViewState>>): KeptViews {
  return {
    viewOf: (_, name) => Effect.succeed(kept[name]),
    newestRecordAt: () => Effect.succeed('2026-11-01T09:00:00.000Z'),
    viewAsOfRun: (_, name) => Effect.succeed(kept[name]),
  };
}

function liveAt(version: number, view: Schema.Json): KeptViewState {
  return {
    version,
    phase: 'live',
    view,
    checkpoint: 'c',
    checkpointAt: '2026-11-01T09:00:00.000Z',
    lastEvent: null,
    folded: 2,
  };
}

const days = { by_day: { unit: 'posts', period: 'day', lines: [] } };

function pagesOver(kept: Readonly<Record<string, KeptViewState>> = {}) {
  return subjectPagesOf({ pool: strippingTheModule, views: keeping(kept) });
}

const pages = pagesOver();

async function contentOf(source: string, writtenIn: 'workflow' | 'playbook' = 'workflow'): Promise<PageContent> {
  const content = await Effect.runPromise(pages.check(source, writtenIn));
  if (content === null || content === undefined) {
    throw new Error('The source has no page');
  }
  return content;
}

const morning = { type: 'workflow', name: 'morning' };

function matching(pattern: string): unknown {
  return expect.stringMatching(new RegExp(pattern, 'u'));
}

function containing(text: string): unknown {
  return expect.stringContaining(text);
}

const someText: unknown = expect.any(String);

function ranWith(output: Schema.Json): RunDetailAsRecorded {
  return {
    run_id: '0199a3c4-0000-7000-8000-000000000001',
    type: 'workflow',
    name: 'morning',
    definition_version: 1,
    status: 'succeeded',
    output: { inline: { date: output } },
    started_at: '2026-11-01T08:00:00.000Z',
    started_by: recordedAdmin,
    finished_at: '2026-11-01T08:01:00.000Z',
  };
}

async function withTheMorning(source = workflowWithData()) {
  const asked = playbookAsked();
  await asked.created('workflow', 'morning', source, { page: await contentOf(source) });
  return asked;
}

describe('the check of a page', () => {
  it('answers the content of the page key of a document, none without one, and null for an empty one', async () => {
    const content = await contentOf(workflowWithData());

    expect(content).toMatchObject({ details: { data: { views: { by_day: 'series' }, foldLine: 12 } } });
    expect(content).toHaveProperty('stripped', { module: 'stripped' });
    expect(await Effect.runPromise(pages.check(functionWithPage(), 'function'))).toEqual({ details: {} });
    expect(await Effect.runPromise(pages.check('name: morning\ndo: []\n', 'workflow'))).toBeUndefined();
    expect(await Effect.runPromise(pages.check('name: morning\npage: {}\n', 'workflow'))).toBeNull();
  });

  it('refuses a page of a document under /source with its line, and the playbook’s under /page', async () => {
    expect(await Effect.runPromise(Effect.flip(pages.check('page:\n  title: Posts\n', 'workflow')))).toMatchObject({
      detail: 'The page has a problem',
      issues: [{ pointer: '/source', detail: matching('^Line 2, /page/title: ') }],
    });
    expect(await Effect.runPromise(Effect.flip(pages.check('title: x\nsubtitle: y\n', 'playbook')))).toMatchObject({
      detail: 'The page has 2 problems',
      issues: [
        { pointer: '/page', detail: matching('^Line 1, /title: ') },
        { pointer: '/page', detail: matching('^Line 2, /subtitle: ') },
      ],
    });
  });
});

describe('the page of a definition', () => {
  it('is the page its document holds, at the version of the definition, and none without one', async () => {
    const asked = await withTheMorning();
    await asked.created('workflow', 'evening', 'name: evening\ndo: []\n');
    await asked.created('workflow', 'night', 'name: night\npage: {}\n', { page: null });

    expect(await asked.ask(pages.pageOf('workflow', 'morning'))).toMatchObject({
      status: 'succeeded',
      output: { answer: { version: 1, source: workflowWithData(), details: { data: { foldLine: 12 } } } },
    });
    const others = await Promise.all(
      ['evening', 'night', 'noon'].map((name) => asked.ask(pages.pageOf('workflow', name))),
    );

    expect(others).toMatchObject([
      { output: { answer: null } },
      { output: { answer: null } },
      { output: { answer: null } },
    ]);
  });

  it('renders nowhere once the definition is retired', async () => {
    const asked = await withTheMorning();
    await asked.record('workflow', { type: 'retire', name: 'morning' });

    expect(await asked.ask(pages.pageOf('workflow', 'morning'))).toMatchObject({ output: { answer: null } });
    expect(await asked.ask(pages.viewsOf(morning))).toMatchObject({ output: { answer: {} } });
    expect(await asked.ask(pages.asOfRun(morning, 'a-run'))).toMatchObject({ output: { answer: {} } });
  });
});

describe('the result of a run on the page of a definition', () => {
  it('renders a run through result, over a run, a sample or the latest run, and nothing where there is no page or no run', async () => {
    const asked = await withTheMorning();
    await asked.created('workflow', 'evening', 'name: evening\ndo: []\n');

    expect(await asked.ask(pages.resultOf('workflow', 'morning', { run: ranWith('2026-11-01') }))).toMatchObject({
      output: { answer: '2026-11-01' },
    });
    expect(await asked.ask(pages.resultOf('workflow', 'morning', { sample: { date: '2026-11-02' } }))).toMatchObject({
      output: { answer: '2026-11-02' },
    });
    expect(await asked.ask(pages.resultOf('workflow', 'morning', { latest: true }))).toMatchObject({
      output: { answer: null },
    });
    expect(await asked.ask(pages.resultOf('workflow', 'evening', { latest: true }))).toMatchObject({
      output: { answer: null },
    });
  });
});

describe('a run that did not succeed, on the page of a definition', () => {
  it('renders a run that was rejected or failed in words of its own', async () => {
    const asked = await withTheMorning();
    const rejected: RunDetailAsRecorded = {
      ...ranWith('2026-11-01'),
      status: 'rejected',
      rejection: { reason: 'conflict', detail: 'The month is closed', kind: 'unworkable' },
    };
    const unexplained: RunDetailAsRecorded = {
      ...ranWith('2026-11-01'),
      status: 'rejected',
      rejection: { reason: 'unavailable', detail: 'Down' },
    };
    const failed: RunDetailAsRecorded = { ...ranWith(null), status: 'failed' };
    const started: RunDetailAsRecorded = { ...Struct.omit(ranWith(null), ['finished_at']), status: 'started' };

    expect(await asked.ask(pages.resultOf('workflow', 'morning', { run: rejected }))).toMatchObject({
      output: { answer: 'The run was rejected as conflict, unworkable. The month is closed' },
    });
    expect(await asked.ask(pages.resultOf('workflow', 'morning', { run: unexplained }))).toMatchObject({
      output: { answer: 'The run was rejected as unavailable. Down' },
    });
    expect(await asked.ask(pages.resultOf('workflow', 'morning', { run: failed }))).toMatchObject({
      output: { answer: 'The run failed.' },
    });
    expect(await asked.ask(pages.resultOf('workflow', 'morning', { run: started }))).toMatchObject({
      output: { answer: someText },
    });
  });

  it('refuses a sample that its subject’s output schema does not take, under /sample_output', async () => {
    const asked = playbookAsked();
    await asked.created('workflow', 'dated', workflowWithData(), {
      output_schema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'] },
      page: await contentOf(workflowWithData()),
    });

    expect(await asked.ask(pages.resultOf('workflow', 'dated', { sample: { date: 1 } }))).toMatchObject({
      status: 'rejected',
      issues: [{ pointer: '/sample_output/date' }],
    });
  });
});

describe('runs on the page of a definition', () => {
  it('renders runs over its views, kept under the type and the name of its subject, and answers their standing', async () => {
    const asked = await withTheMorning();
    const building = pagesOver({ 'workflow/morning': { ...liveAt(1, days), phase: 'rebuilding' } });

    expect(await asked.ask(pagesOver({ 'workflow/morning': liveAt(1, days) }).viewsOf(morning))).toMatchObject({
      output: {
        answer: { runs: containing(JSON.stringify(days.by_day)), standing: { state: 'live', version: 1, folded: 2 } },
      },
    });
    expect(await asked.ask(building.viewsOf(morning))).toMatchObject({
      output: { answer: { runs: containing('Building'), standing: { state: 'rebuilding' } } },
    });
    expect(await asked.ask(pages.viewsOf(morning))).toMatchObject({
      output: { answer: { runs: containing('Building'), standing: { state: 'rebuilding', version: 1 } } },
    });
  });

  it('has no runs and no standing without data, and none where there is no page', async () => {
    const asked = await withTheMorning(workflowWithPage());
    await asked.created('workflow', 'evening', 'name: evening\ndo: []\n');

    expect(await asked.ask(pages.viewsOf(morning))).toMatchObject({ output: { answer: {} } });
    expect(await asked.ask(pages.asOfRun(morning, 'a-run'))).toMatchObject({ output: { answer: {} } });
    expect(await asked.ask(pages.viewsOf({ type: 'workflow', name: 'evening' }))).toMatchObject({
      output: { answer: {} },
    });
  });
});

describe('the page of the playbook', () => {
  it('is saved on the playbook’s own stream, each save that changes it a version on, and removed with null', async () => {
    const asked = playbookAsked();
    const saved = { source: playbookPage, content: await contentOf(playbookPage, 'playbook') };

    expect(await asked.ask(pages.playbookPageOf())).toMatchObject({ output: { answer: null } });
    expect(await asked.ask(pages.savePlaybookPage(null))).toMatchObject({ output: { answer: null } });
    expect(await asked.ask(pages.savePlaybookPage(saved))).toMatchObject({
      output: { answer: { version: 1, source: playbookPage } },
    });
    expect(await asked.ask(pages.savePlaybookPage(saved))).toMatchObject({ output: { answer: { version: 1 } } });
    expect(await asked.ask(pages.savePlaybookPage(null))).toMatchObject({ output: { answer: null } });
    expect(await asked.ask(pages.savePlaybookPage(null))).toMatchObject({ output: { answer: null } });
    expect(await asked.ask(pages.playbookPageOf())).toMatchObject({ output: { answer: null } });
    expect(await asked.ask(pages.savePlaybookPage(null))).toMatchObject({ output: { answer: null } });
    expect(await asked.ask(pages.savePlaybookPage(saved))).toMatchObject({ output: { answer: { version: 3 } } });
  });

  it('renders runs over the views kept under the playbook’s name', async () => {
    const asked = playbookAsked();

    expect(await asked.ask(pages.viewsOf('playbook'))).toMatchObject({ output: { answer: {} } });
    await asked.ask(
      pages.savePlaybookPage({ source: playbookPage, content: await contentOf(playbookPage, 'playbook') }),
    );

    expect(await asked.ask(pagesOver({ 'playbook/alpha': liveAt(1, days) }).viewsOf('playbook'))).toMatchObject({
      output: { answer: { runs: containing(JSON.stringify(days.by_day)), standing: { state: 'live' } } },
    });
  });
});
