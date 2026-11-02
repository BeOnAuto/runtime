import { describe, expect, it } from 'vitest';

import { definitionPresentedBy, publishedPageDetails } from './page-details.ts';

describe('the details of a page', () => {
  it('publish its subject and its views, and nothing of details that are not a page’s', () => {
    const views = { by_day: 'series' };

    const data = { views, language: 'typescript', fold: 'export function fold() {}', foldLine: 9, filters: [] };

    expect(publishedPageDetails({ of: 'playbook', data })).toEqual({
      of: 'playbook',
      views,
    });
    expect(publishedPageDetails({ shape: 'series' })).toEqual({});
  });

  it('name the definition a page presents, and none for the playbook or details that are not a page’s', () => {
    expect([
      definitionPresentedBy({ of: 'workflow/morning-social-content' }),
      definitionPresentedBy({ of: 'playbook' }),
      definitionPresentedBy({ shape: 'series' }),
    ]).toEqual([{ type: 'workflow', name: 'morning-social-content' }, undefined, undefined]);
  });
});
