import { describe, expect, it } from 'vitest';

import { commentOperations } from './comment-composition.ts';

describe('the operations of comments a catalog serves', () => {
  it('are making a comment, listing the comments and resolving one, all in a playbook', () => {
    expect(commentOperations.map(({ registration: { scope, name } }) => [scope, name])).toEqual([
      ['playbook', 'make_comment'],
      ['playbook', 'list_comments'],
      ['playbook', 'resolve_comment'],
    ]);
  });
});
