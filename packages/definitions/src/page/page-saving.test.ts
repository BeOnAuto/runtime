import { describe, expect, it } from 'vitest';

import { greeting, playbookWithTheWorkflow, refusedAtTheSource } from '../testing/page-playbooks.ts';
import { latelyOfTheDays, pageData, pageOf, pageWithData } from '../testing/pages.ts';

describe('saving a page', () => {
  it('keeps it as a definition of the type page, showing its subject and its views and nothing that runs', async () => {
    const { saving, ready } = playbookWithTheWorkflow();
    await ready;

    const saved = await saving({
      type: 'page',
      name: 'morning-posts',
      source: pageWithData({ front: 'description: The posts of each morning' }),
    });

    expect(saved).toMatchObject({
      status: 'succeeded',
      output: {
        type: 'page',
        name: 'morning-posts',
        version: 1,
        status: 'active',
        media_type: 'text/markdown',
        description: 'The posts of each morning',
        details: { of: 'workflow/morning-social-content', views: { by_day: 'series' } },
      },
    });
    for (const field of ['used_by', 'input_schema', 'output_schema', 'overview', 'diagram']) {
      expect(saved).not.toHaveProperty(`output.${field}`);
    }
  });

  it('shows no views for a page without data, and takes the playbook as its subject', async () => {
    const { saving, ready } = playbookWithTheWorkflow();
    await ready;

    expect(await saving({ type: 'page', name: 'morning-posts', source: pageOf() })).toMatchObject({
      status: 'succeeded',
      output: { details: { of: 'workflow/morning-social-content' } },
    });
    expect(
      await saving({
        type: 'page',
        name: 'playbook-page',
        source: pageOf({ of: 'playbook', body: latelyOfTheDays, data: pageData() }),
      }),
    ).toMatchObject({ status: 'succeeded', output: { details: { of: 'playbook', views: { by_day: 'series' } } } });
  });
});

describe('the document of a page', () => {
  it('is refused with each of its problems', async () => {
    const { saving } = playbookWithTheWorkflow();

    expect(
      await saving({ type: 'page', name: 'morning-posts', source: pageOf({ of: 'page/other', body: '' }) }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The page has 2 problems',
    });
  });

  it('is refused when it does not fit the format, under its source', async () => {
    const { saving } = playbookWithTheWorkflow();

    expect(await saving({ type: 'page', name: 'morning-posts', source: pageOf({ of: 'page/other' }) })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The page has a problem',
      issues: [
        {
          pointer: '/source',
          detail:
            'Line 2, /of: A page presents no page, since a page has no results to present; of names a workflow, a function or playbook',
        },
      ],
    });
  });
});

describe('the subject of a page', () => {
  it('refuses a subject the playbook does not have, has retired, or cannot have on this server', async () => {
    const { saving, retiring, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'reasoning', name: 'review-brief', source: greeting, diagram: 'none' });
    await retiring({ type: 'reasoning', name: 'review-brief' });

    expect(
      await saving({ type: 'page', name: 'evening-posts', source: pageOf({ of: 'workflow/evening-posts' }) }),
    ).toEqual(
      refusedAtTheSource(
        'Line 2, /of: of names the workflow evening-posts, which the playbook does not have; a page presents what the playbook has',
      ),
    );
    expect(await saving({ type: 'page', name: 'reviews', source: pageOf({ of: 'reasoning/review-brief' }) })).toEqual(
      refusedAtTheSource(
        'Line 2, /of: of names the reasoning function review-brief, which the playbook retired; a page presents what the playbook has',
      ),
    );
    expect(
      await saving({ type: 'page', name: 'forecasts', source: pageOf({ of: 'prediction/weekly-orders' }) }),
    ).toEqual(
      refusedAtTheSource(
        'Line 2, /of: of names the prediction function weekly-orders, which the playbook does not have; a page presents what the playbook has',
      ),
    );
  });
});

describe('the one page of a subject', () => {
  it('refuses a second active page of one subject as a conflict', async () => {
    const { saving, ready } = playbookWithTheWorkflow();
    await ready;
    await saving({ type: 'page', name: 'morning-posts', source: pageOf() });
    await saving({
      type: 'page',
      name: 'playbook-page',
      source: pageOf({ of: 'playbook', body: latelyOfTheDays, data: pageData() }),
    });

    expect(await saving({ type: 'page', name: 'posts-again', source: pageOf() })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The workflow morning-social-content already has the page morning-posts, and a subject has one page at a time; update that page, or retire it before saving another',
    });
    expect(
      await saving({
        type: 'page',
        name: 'playbook-again',
        source: pageOf({ of: 'playbook', body: latelyOfTheDays, data: pageData() }),
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The playbook already has the page playbook-page, and a subject has one page at a time; update that page, or retire it before saving another',
    });
  });
});

describe('the overview and the diagram of a page', () => {
  it('are refused, since Auto Studio shows the page itself', async () => {
    const { saving, ready } = playbookWithTheWorkflow();
    await ready;
    const overview = 'A page takes no overview, since Auto Studio shows the page itself; leave overview out';
    const diagram = 'A page takes no diagram, since Auto Studio shows the page itself; leave diagram out';

    expect(await saving({ type: 'page', name: 'morning-posts', source: pageOf(), overview: 'The posts' })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: overview,
      issues: [{ detail: overview, pointer: '/overview' }],
    });
    expect(await saving({ type: 'page', name: 'morning-posts', source: pageOf(), diagram: 'none' })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: diagram,
      issues: [{ detail: diagram, pointer: '/diagram' }],
    });
  });
});
