import { describe, expect, it } from 'vitest';

import { withLinksResolved } from './page-links.ts';

describe('the links of a page served as a guide', () => {
  it('point a relative link at the published page, with its fragment', () => {
    expect(
      withLinksResolved(
        'See [Tool servers](http.md#tool-servers) and [Availability](../concepts/functions.md#availability).',
        'reference/reasoning-format.md',
      ),
    ).toBe(
      'See [Tool servers](https://on.auto/docs/reference/http#tool-servers) and [Availability](https://on.auto/docs/concepts/functions#availability).',
    );
  });

  it('keep a link that is already absolute, and keep only the words of a link within the page', () => {
    expect(
      withLinksResolved(
        '[the guide](https://example.com/guide) and [When a run fails](#when-a-run-fails)',
        'reference/computation-format.md',
      ),
    ).toBe('[the guide](https://example.com/guide) and When a run fails');
  });

  it('leave what looks like a link inside a block of code as it is', () => {
    const page = 'Before [it](http.md).\n\n```ts\nview[campaign](x)\n```\n\nAfter [it](http.md).\n';

    expect(withLinksResolved(page, 'reference/computation-format.md')).toBe(
      'Before [it](https://on.auto/docs/reference/http).\n\n```ts\nview[campaign](x)\n```\n\nAfter [it](https://on.auto/docs/reference/http).\n',
    );
  });
});
