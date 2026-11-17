import { Effect, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeptViews, KeptViewState } from '../capability/view-standing.ts';
import type { RunDetailAsRecorded } from '../runs/run.ts';
import { renderClock } from '../template/render-clock.ts';
import type { ParsedTemplate, VariableSegment } from '../template/template-parsing.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { textKeptIn } from '../testing/kept-documents.ts';
import { watchedStore } from '../testing/kept-payloads.ts';
import { playbookAsked } from '../testing/page-asking.ts';
import {
  foldingNothing,
  playbookWithTheWorkflow,
  runsOfTheDays,
  workflowWithItsPage,
} from '../testing/page-playbooks.ts';
import { keepingTheViews, pagesOver } from '../testing/page-ports.ts';
import { workflowWithData } from '../testing/pages.ts';
import type { ParsedGlance } from './page-document.ts';
import { glanceOf, glanceShown, mostGlanceBytes } from './page-glance.ts';
import { withoutThePage } from './page-lines.ts';
import { glanceNamesTheOutput } from './page-rendering.ts';
import { type PageContent, subjectPagesOf } from './subject-pages.ts';

const clock = Effect.runSync(renderClock);

const at = { lineAt: () => 7, views: { done: 'categories' as const } };

function parsed(value: Schema.JsonObject) {
  return Result.getOrThrow(glanceOf(value, at));
}

function shown(value: Schema.JsonObject, variables: Readonly<Record<string, Schema.Json>> = {}) {
  return glanceShown(parsed(value), {
    variables: {
      views: { done: { values: [{ name: 'A', value: 2 }] } },
      output: { blockers: ['Authorize'] },
      ...variables,
    },
    clock,
  });
}

function issuesOf(check: () => ReturnType<typeof glanceOf>): readonly string[] {
  return Result.match(check(), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map(({ line, pointer }) => `${line} ${pointer}`),
  });
}

function detailsOf(check: () => ReturnType<typeof glanceOf>): readonly string[] {
  return Result.match(check(), { onSuccess: () => [], onFailure: (issues) => issues.map(({ detail }) => detail) });
}

function reading(...path: readonly VariableSegment[]): ParsedGlance {
  const template: ParsedTemplate = {
    templates: () => [],
    variables: [{ path, line: 1 }],
    issues: [],
    text: '',
    firstLine: 1,
  };
  return { kind: 'text', template, whole: false };
}

const aValue: ParsedGlance = { kind: 'value', value: 3 };

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

async function contentOf(sourcePageViewsRead: string): Promise<PageContent> {
  const content = await Effect.runPromise(pages.check(sourcePageViewsRead, 'workflow'));
  if (content === null || content === undefined) {
    throw new Error('The source has no page');
  }
  return content;
}

const keepingNoViews: KeptViews = {
  viewOf: () => Effect.undefined,
  newestRecordAt: () => Effect.undefined,
  viewAsOfRun: () => Effect.undefined,
};

const pagesKeptPageDocuments = subjectPagesOf({
  pool: {
    check: () => Promise.resolve({ ran: 'checked', issues: [], stripped: { expressions: [] }, milliseconds: 0 }),
  },
  views: keepingNoViews,
});

const source = `# ${'A morning that is written at length. '.repeat(60)}\n${workflowWithData()}`;

const morning = { type: 'workflow', name: 'morning' };

const pastTheHour = '2026-10-01T11:00:00.000Z';

const alpha = { org: 'acme', playbook: 'alpha' };

function ranWith(date: Schema.Json): RunDetailAsRecorded {
  return {
    run_id: '0199a3c4-0000-7000-8000-000000000001',
    type: 'workflow',
    name: 'morning',
    definition_version: 1,
    status: 'succeeded',
    output: { inline: { date } },
    started_at: '2026-11-01T08:00:00.000Z',
    started_by: recordedAdmin,
    finished_at: '2026-11-01T08:01:00.000Z',
  };
}

async function morningKeptOutside() {
  const watched = watchedStore();
  const asked = playbookAsked(watched.store);
  const page = await Effect.runPromise(pagesKeptPageDocuments.check(source, 'workflow'));
  const kept = await asked.playbook.run(textKeptIn(asked.playbook.ledger.service.content, alpha, source));
  const texts = { source_sha256: kept.sha256, source_bytes: kept.bytes };
  await asked.record('workflow', {
    type: 'create',
    name: 'morning',
    content: { ...texts, ...(page === undefined ? {} : { page }) },
    created_by: recordedAdmin,
    definition_id: 'id-of-it',
  });
  return { asked, watched };
}

const sizeOfTheDocument = new TextEncoder().encode(source).byteLength.toLocaleString('en-US');

describe('a glance as written', () => {
  it('keeps numbers, nulls and lists, and reads each string as a template', () => {
    expect(
      shown({
        headline: '{{ views.done.values | size }} done.',
        visual: {
          kind: 'figures',
          items: [
            { name: 'Done', value: 2, limit: null },
            { name: 'Open', value: true },
          ],
        },
        outstanding: [{ kind: 'blocker', title: '{{ output.blockers[0] }}' }],
      }),
    ).toEqual({
      headline: '1 done.',
      visual: {
        kind: 'figures',
        items: [
          { name: 'Done', value: 2, limit: null },
          { name: 'Open', value: true },
        ],
      },
      outstanding: [{ kind: 'blocker', title: 'Authorize' }],
    });
  });

  it('reads a string that is one output alone as the JSON its text says, and any other as text', () => {
    expect(
      shown({
        count: '{{ views.done.values | size }}',
        points: '{{ views.done.values | json }}',
        word: '{{ output.blockers[0] }}',
        sentence: 'Count {{ views.done.values | size }}',
      }),
    ).toEqual({ count: 1, points: [{ name: 'A', value: 2 }], word: 'Authorize', sentence: 'Count 1' });
  });
});

describe('a glance refused', () => {
  it('names each template that reads what the glance does not have, under its own pointer and line', () => {
    expect(
      issuesOf(() => glanceOf({ headline: '{{ input.name }}', visual: { name: '{{ views.missing }}' } }, at)),
    ).toEqual(['7 /glance/headline', '7 /glance/visual/name']);
    expect(issuesOf(() => glanceOf({ items: ['{{ nope }}', 'fine'] }, at))).toEqual(['7 /glance/items/0']);
    expect(issuesOf(() => glanceOf({ headline: '{% if %}' }, at))).toEqual(['7 /glance/headline']);
  });

  it('is past 16 KiB as JSON', () => {
    expect(detailsOf(() => glanceOf({ headline: 'x'.repeat(mostGlanceBytes) }, at))).toEqual([
      `The glance takes ${mostGlanceBytes + 15} bytes as JSON, more than the ${mostGlanceBytes} it may take`,
    ]);
  });
});

describe('a glance rendered', () => {
  it('is none where a template stops, in a mapping or a list', () => {
    expect(shown({ headline: '{{ "dollars" | money }}' }, { output: null })).toBeUndefined();
    expect(shown({ items: ['{{ "dollars" | money }}'] }, { output: null })).toBeUndefined();
  });
});

describe('a glance, as the read of the latest run’s output asks it', () => {
  it('names the output where any of its templates reads it, in a mapping or a list at any depth', () => {
    expect([
      glanceNamesTheOutput(reading('output', 'greeting')),
      glanceNamesTheOutput({
        kind: 'mapping',
        entries: [
          ['n', aValue],
          ['said', reading('output')],
        ],
      }),
      glanceNamesTheOutput({ kind: 'list', items: [aValue, { kind: 'list', items: [reading('output', 0)] }] }),
    ]).toEqual([true, true, true]);
  });

  it('names none where its templates read only the views, the run and the moment, or it holds values alone', () => {
    expect([
      glanceNamesTheOutput(reading('run', 'status')),
      glanceNamesTheOutput(aValue),
      glanceNamesTheOutput({
        kind: 'mapping',
        entries: [
          ['n', aValue],
          ['days', reading('views', 'by_day')],
        ],
      }),
      glanceNamesTheOutput({ kind: 'list', items: [reading('today')] }),
    ]).toEqual([false, false, false, false]);
  });
});

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
    const {
      updating,
      reading: readingPageGlanceReads,
      running,
      ready,
    } = playbookWithTheWorkflow(keepingTheViews(liveDays));
    await ready;
    await updating({ ...workflow, source: counting });

    expect(await readingPageGlanceReads(workflow)).toMatchObject({
      output: { page: { runs: '1 days', glance: { headline: '', days: 1, ran: '', outstanding: [] } } },
    });
    await running({ ...workflow, input: {} });
    expect(await readingPageGlanceReads(workflow)).toMatchObject({
      output: { page: { glance: { headline: 'Good morning', days: 1, ran: 'succeeded' } } },
    });
  });

  it('reads the latest ended run alone on a page without views', async () => {
    const { updating, reading: readingPageGlanceReads, running, ready } = playbookWithTheWorkflow();
    await ready;
    await updating({ ...workflow, source: workflowWithItsPage("glance:\n  headline: '{{ output.greeting }}'") });
    await running({ ...workflow, input: {} });
    expect(await readingPageGlanceReads(workflow)).toMatchObject({
      output: { page: { glance: { headline: 'Good morning' } } },
    });
  });

  it('reads no views while they are built, and has none where a template stops', async () => {
    const buildingPageGlanceReads = playbookWithTheWorkflow();
    await buildingPageGlanceReads.ready;
    await buildingPageGlanceReads.updating({ ...workflow, source: counting });
    expect(await buildingPageGlanceReads.reading(workflow)).toMatchObject({
      output: { page: { glance: { days: 0 } } },
    });

    const stopping = playbookWithTheWorkflow(keepingTheViews(liveDays));
    await stopping.ready;
    await stopping.updating({ ...workflow, source: glanceOver('  headline: \'{{ "dollars" | money }}\'') });
    expect(await stopping.reading(workflow)).not.toHaveProperty('output.page.glance');
  });
});

describe('a document without its page', () => {
  it('keeps every line, the lines of its page key blank, whether the page ends the document or not', () => {
    expect(withoutThePage('name: morning\npage:\n  result: |\n    Hi\ndo: []\n', 'workflow')).toBe(
      'name: morning\n\n\n\ndo: []\n',
    );
    expect(withoutThePage('---\nmodel: x\npage:\n  result: Hi\n---\nSay hi.\n', 'function')).toBe(
      '---\nmodel: x\n\n\n---\nSay hi.\n',
    );
  });

  it('is the document as it is without a page key, or without front matter for a function', () => {
    expect(withoutThePage('name: morning\ndo: []\n', 'workflow')).toBe('name: morning\ndo: []\n');
    expect(withoutThePage('page: x\n', 'function')).toBe('page: x\n');
    expect(withoutThePage('---\npage: x\n', 'function')).toBe('---\npage: x\n');
  });
});

describe('the views of a page as a read shows them', () => {
  it('are read once, so its figures and their standing are of one moment though the views move on between reads', async () => {
    const asked = playbookAsked();
    await asked.created('workflow', 'morning', workflowWithData(), { page: await contentOf(workflowWithData()) });

    expect(await asked.ask(pages.viewsOf({ type: 'workflow', name: 'morning' }))).toMatchObject({
      output: { answer: { runs: building, standing: { state: 'rebuilding' } } },
    });
  });
});

describe('the page of a definition whose document its playbook keeps outside its fact', () => {
  it('renders from the document it reads from the store, once for each render', async () => {
    const { asked, watched } = await morningKeptOutside();

    expect(
      await asked.ask(pagesKeptPageDocuments.resultOf('workflow', 'morning', { run: ranWith('2026-11-01') })),
    ).toMatchObject({
      output: { answer: '2026-11-01' },
    });
    expect(watched.reads()).toBe(1);
  });

  it('says, where its document would render, why it cannot be shown while the document is gone', async () => {
    const { asked, watched } = await morningKeptOutside();
    watched.lose();
    const words = `The page of workflow/morning could not be shown: its document, ${sizeOfTheDocument} bytes, is missing from the playbook's content.`;

    expect([
      await asked.ask(
        pagesKeptPageDocuments.resultOf('workflow', 'morning', { run: ranWith('2026-11-01') }),
        pastTheHour,
      ),
      await asked.ask(pagesKeptPageDocuments.viewsOf(morning), pastTheHour),
      await asked.ask(pagesKeptPageDocuments.asOfRun(morning, 'a-run'), pastTheHour),
    ]).toMatchObject([
      { output: { answer: words } },
      { output: { answer: { runs: words } } },
      { output: { answer: { runs: words } } },
    ]);
  });

  it('says so too while the document cannot be read just now, and shows it once it can', async () => {
    const { asked, watched } = await morningKeptOutside();
    watched.fail();

    expect(
      await asked.ask(pagesKeptPageDocuments.resultOf('workflow', 'morning', { run: ranWith('2026-11-01') })),
    ).toMatchObject({
      output: {
        answer: `The page of workflow/morning could not be shown: its document, ${sizeOfTheDocument} bytes, could not be read just now; it shows here once it can be read.`,
      },
    });
  });
});
