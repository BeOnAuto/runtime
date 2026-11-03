import { describe, expect, it } from 'vitest';

import { currentAddressOf, pagesOfTheirOwnIn, pagesOfTheirOwnOf } from './current-addresses.ts';

const carried = {
  version: 3,
  source: '---\n---\n{% result %}{% endresult %}\n',
  details: {},
  saved_at: '2026-10-01T09:00:00.000Z',
};

const pages = pagesOfTheirOwnIn(
  new Map([
    ['workflow/close-the-week', { ...carried, name: 'weekly-close' }],
    ['playbook', { ...carried, name: 'dashboard' }],
  ]),
);

describe('the current address of a comment made on a page saved as a definition of its own', () => {
  it('is its subject without a version, and the playbook’s page or its parts of lately for the playbook’s', () => {
    expect(
      [
        'finance/definitions/page/weekly-close/3/parts/lately-2-1',
        'finance/definitions/page/weekly-close/3',
        'finance/definitions/page/dashboard/1/parts/lately-1',
        'finance/definitions/page/dashboard/1/parts/source',
        'finance/definitions/page/dashboard/1',
      ].map((address) => currentAddressOf(address, pages)),
    ).toEqual([
      'finance/definitions/workflow/close-the-week',
      'finance/definitions/workflow/close-the-week',
      'playbooks/finance/parts/lately-1',
      'playbooks/finance',
      'playbooks/finance',
    ]);
  });

  it('stays as it is for a page the playbook does not carry, and for any other address', () => {
    expect(
      [
        'finance/definitions/page/gone/1/parts/lately-1',
        'finance/definitions/page/weekly-close',
        'finance/definitions/workflow/close-the-week/4/parts/lately-2',
        'org/parts/playbooks',
      ].map((address) => currentAddressOf(address, pages)),
    ).toEqual([
      'finance/definitions/page/gone/1/parts/lately-1',
      'finance/definitions/page/weekly-close',
      'finance/definitions/workflow/close-the-week/4/parts/lately-2',
      'org/parts/playbooks',
    ]);
  });
});

describe('the pages of their own of a subject', () => {
  it('are named as the comments made on them name their definition', () => {
    expect(pagesOfTheirOwnOf(pages, 'workflow', 'close-the-week')).toEqual(['page/weekly-close']);
    expect(pagesOfTheirOwnOf(pages, 'workflow', 'other')).toEqual([]);
  });
});
