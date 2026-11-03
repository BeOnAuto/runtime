import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookAsked } from '../testing/page-asking.ts';
import { pageData, pageOf, resultOfTheDate, workflowWithPage } from '../testing/pages.ts';
import { carriedPagesIn, sourceWithoutItsSubject } from './pages-saved-as-definitions.ts';
import { subjectPagesOf } from './subject-pages.ts';

const pages = subjectPagesOf({
  pool: {
    check: () =>
      Promise.resolve({ ran: 'checked' as const, issues: [], stripped: { expressions: [] }, milliseconds: 0 }),
  },
  views: {
    viewOf: () => Effect.undefined,
    newestRecordAt: () => Effect.undefined,
    viewAsOfRun: () => Effect.undefined,
  },
});

const latelyOfTheDays = '{% lately %}\n{{ views.by_day | json }}\n{% endlately %}';

function savedAsADefinition(of: string, body = `${resultOfTheDate}\n\n${latelyOfTheDays}`): string {
  return pageOf({ front: `of: ${of}`, data: pageData(), body });
}

const morningPage = savedAsADefinition('workflow/morning');

const playbookPage = pageOf({
  front: 'of: playbook',
  data: `${pageData()}\ndescription: The posts of each day`,
  body: '{% lately %}\n{{ views.by_day | json }}\n\nPosts so far.\n{% endlately %}',
});

const details = (of: string) => ({ of, data: { foldLine: 12 } });

const building: unknown = expect.stringContaining('Building');

const savedBack = Effect.gen(function* () {
  const read = yield* Effect.orDie(Effect.fromNullishOr(yield* pages.playbookPageOf()));
  const content = yield* Effect.orDie(Effect.fromNullishOr(yield* pages.check(read.source, 'playbook')));
  const saved = yield* pages.savePlaybookPage({ source: read.source, content });
  return { read, saved, same: JSON.stringify(content.details) === JSON.stringify(read.details) };
});

async function withPagesOfTheirOwn() {
  const asked = playbookAsked();
  await asked.created('workflow', 'morning', 'name: morning\ndo: []\n');
  await asked.created('page', 'morning-posts', morningPage, { details: details('workflow/morning') });
  await asked.record('page', {
    type: 'update',
    name: 'morning-posts',
    content: { source: `${morningPage}\n`, details: details('workflow/morning'), stripped: { module: 'm' } },
  });
  await asked.created('page', 'dashboard', playbookPage, { details: details('playbook') });
  return asked;
}

describe('a page saved as a definition of its own', () => {
  it('is its subject’s page at its own version, its source the mapping of a page key and its details read again from it', async () => {
    const asked = await withPagesOfTheirOwn();

    expect(await asked.ask(pages.pageOf('workflow', 'morning'))).toMatchObject({
      output: {
        answer: {
          version: 2,
          source: `${pageData()}\nresult: |2\n  {{ output.date }}\nlately: |2\n  {{ views.by_day | json }}\n`,
          details: { data: { foldLine: 10, views: { by_day: 'series' } } },
        },
      },
    });
    expect(await asked.ask(pages.playbookPageOf())).toMatchObject({ output: { answer: { version: 1 } } });
  });

  it('of the playbook reads back as a page the playbook saves, and saves back unchanged', async () => {
    const asked = await withPagesOfTheirOwn();
    const mapping = `${pageData()}\nlately: |2\n  {{ views.by_day | json }}\n\n  Posts so far.\n`;

    expect(await asked.ask(savedBack)).toMatchObject({
      output: {
        answer: {
          read: { version: 1, source: mapping },
          saved: { version: 1, source: mapping },
          same: true,
        },
      },
    });
    expect(await asked.ask(pages.playbookPageOf())).toMatchObject({
      output: { answer: { version: 1, source: mapping } },
    });
    expect(await asked.ask(pages.viewsOf('playbook'))).toMatchObject({ output: { answer: { lately: building } } });
  });

  it('keeps the forms its save stripped, for the views', async () => {
    const asked = await withPagesOfTheirOwn();

    expect(await asked.ask(Effect.map(carriedPagesIn, (carried) => carried.get('workflow/morning')))).toMatchObject({
      output: { answer: { name: 'morning-posts', stripped: { module: 'm' } } },
    });
  });
});

describe('a page saved as a definition of its own that gives way', () => {
  it('gives way to the page key of its subject, and to an empty one, which means no page', async () => {
    const asked = await withPagesOfTheirOwn();
    await asked.created('workflow', 'evening', 'name: evening\npage: {}\n', { page: null });
    await asked.record('page', {
      type: 'create',
      name: 'evening-posts',
      content: { source: savedAsADefinition('workflow/evening'), details: details('workflow/evening') },
      created_by: { id: 'acme-admin', name: 'acme-admin' },
    });
    await asked.record('workflow', {
      type: 'update',
      name: 'morning',
      content: { source: workflowWithPage(), page: { details: {} } },
    });

    expect(await asked.ask(pages.pageOf('workflow', 'morning'))).toMatchObject({
      output: { answer: { version: 2, source: workflowWithPage() } },
    });
    expect(await asked.ask(pages.pageOf('workflow', 'evening'))).toMatchObject({ output: { answer: null } });
  });

  it('gives way to a page the playbook saves itself', async () => {
    const asked = await withPagesOfTheirOwn();
    await asked.ask(pages.savePlaybookPage(null));

    expect(await asked.ask(pages.playbookPageOf())).toMatchObject({ output: { answer: null } });
  });

  it('is no page once it was retired, nor where its details name no subject or its source no longer reads as a page', async () => {
    const asked = await withPagesOfTheirOwn();
    await asked.record('page', { type: 'retire', name: 'morning-posts' });
    await asked.created('page', 'unnamed', pageOf(), { details: {} });
    await asked.created('page', 'twice', pageOf({ front: 'of: playbook\nof: playbook' }), {
      details: details('workflow/noon'),
    });

    expect(await asked.ask(Effect.map(carriedPagesIn, (carried) => [...carried.keys()]))).toMatchObject({
      output: { answer: ['playbook'] },
    });
  });
});

describe('the source of a page saved as a definition of its own', () => {
  it('loses the one line of of in its front matter, and nothing else', () => {
    expect(sourceWithoutItsSubject('---\nof: playbook\ndescription: of: posts\n---\nof: x\n')).toBe(
      '---\ndescription: of: posts\n---\nof: x\n',
    );
    expect(sourceWithoutItsSubject('---\ndescription: Posts\n---\nof: x\n')).toBe(
      '---\ndescription: Posts\n---\nof: x\n',
    );
  });
});
