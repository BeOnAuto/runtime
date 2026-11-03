import { describe, expect, it } from 'vitest';

import { pageDetailsIn } from './page-details.ts';

describe('the details of a page', () => {
  it('are its data, and nothing for details that are not a page’s', () => {
    const data = {
      views: { by_day: 'series' },
      language: 'typescript',
      fold: 'export function fold() {}',
      foldLine: 9,
      filters: [{ type: 'run_succeeded' }],
    } as const;

    expect(pageDetailsIn({ data })).toEqual({ data });
    expect(pageDetailsIn({ data: { ...data, language: 'python' } })).toBeUndefined();
  });
});
