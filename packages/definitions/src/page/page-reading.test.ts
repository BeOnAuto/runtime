import { describe, expect, it } from 'vitest';

import { playbookWithTheWorkflow, refusedAtTheSource } from '../testing/page-playbooks.ts';
import { pageOperations } from '../testing/page-ports.ts';
import { latelyOfTheDays, pageData, pageOf, pageWithData } from '../testing/pages.ts';
import { pageNeverRuns } from './page-adapter.ts';

const { listDefinitions, runDefinition, listRuns } = pageOperations;

describe('updating a page', () => {
  it('saves a new version of the page as it presents the same subject', async () => {
    const { saving, updating, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: pageOf() });

    expect(await updating({ type: 'page', name: 'morning-posts', source: pageWithData() })).toMatchObject({
      status: 'succeeded',
      output: { version: 2, details: { of: 'workflow/morning-social-content', views: { by_day: 'series' } } },
    });
  });

  it('refuses another subject, since a page belongs to its subject', async () => {
    const { saving, updating, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: pageOf() });

    expect(
      await updating({
        type: 'page',
        name: 'morning-posts',
        source: pageOf({ of: 'playbook', body: latelyOfTheDays, data: pageData() }),
      }),
    ).toEqual(
      refusedAtTheSource(
        'Line 2, /of: A page belongs to its subject, so of stays workflow/morning-social-content; to present another subject, retire this page and save a new one',
      ),
    );
  });

  it('answers as any update does for a page the playbook does not have', async () => {
    const { updating } = playbookWithTheWorkflow();

    expect(
      await updating({
        type: 'page',
        name: 'morning-posts',
        source: pageOf({ of: 'playbook', body: latelyOfTheDays, data: pageData() }),
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no page morning-posts in this playbook',
    });
  });
});

describe('reading pages', () => {
  it('lists pages on their own, apart from the functions and workflows', async () => {
    const { playbook, asked, saving, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: pageOf() });

    const listed = (type: string) => playbook.call(listDefinitions, asked({ type }));

    expect(await listed('page')).toMatchObject({
      status: 'succeeded',
      output: {
        definitions: [{ type: 'page', name: 'morning-posts', details: { of: 'workflow/morning-social-content' } }],
      },
    });
    expect(await listed('workflow')).toMatchObject({
      status: 'succeeded',
      output: { definitions: [{ type: 'workflow', name: 'morning-social-content' }] },
    });
  });

  it('does not list a page among the users of its subject, whose runs its views fold', async () => {
    const { saving, reading, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: pageWithData() });

    const subject = await reading({ type: 'workflow', name: 'morning-social-content' });

    expect(subject).toMatchObject({ status: 'succeeded' });
    expect(subject).not.toHaveProperty('output.used_by');
  });
});

describe('the standing of a page’s views', () => {
  it('is read with a page that has data, and with no other', async () => {
    const { saving, reading, retiring, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: pageWithData() });
    await saving({
      type: 'page',
      name: 'playbook-page',
      source: pageOf({ of: 'playbook', body: latelyOfTheDays, data: pageData() }),
    });
    await retiring({ type: 'page', name: 'playbook-page' });

    expect(await reading({ type: 'page', name: 'morning-posts' })).toMatchObject({
      status: 'succeeded',
      output: { standing: { state: 'rebuilding', version: 1, folded: 0 } },
    });
    expect(await reading({ type: 'page', name: 'playbook-page' })).not.toHaveProperty('output.standing');
  });

  it('is not read for a page without data', async () => {
    const { saving, reading, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: pageOf() });

    expect(await reading({ type: 'page', name: 'morning-posts' })).not.toHaveProperty('output.standing');
  });
});

describe('retiring', () => {
  it('the subject retires its page, and a page retired on its own frees its subject', async () => {
    const { saving, reading, retiring, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: pageOf() });
    await retiring({ type: 'page', name: 'morning-posts' });
    await saving({ type: 'page', name: 'posts-again', source: pageOf() });

    await retiring({ type: 'workflow', name: 'morning-social-content' });

    expect(await reading({ type: 'page', name: 'posts-again' })).toMatchObject({
      status: 'succeeded',
      output: { status: 'retired' },
    });
  });
});

describe('a page never runs', () => {
  it('so a run of it is refused before it starts, and runs are never listed by it', async () => {
    const { playbook, asked, saving, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: pageOf() });

    expect(await playbook.call(runDefinition, asked({ type: 'page', name: 'morning-posts' }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ pointer: '/type', detail: pageNeverRuns }],
    });
    expect(await playbook.call(listRuns, asked({ type: 'page' }))).toMatchObject({
      status: 'rejected',
      issues: [{ pointer: '/type', detail: pageNeverRuns }],
    });
  });
});
