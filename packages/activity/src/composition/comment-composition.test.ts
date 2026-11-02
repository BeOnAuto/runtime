import { describe, expect, it } from 'vitest';

import { commentOperations, orgCommentOperations } from './comment-composition.ts';

describe('the operations of comments a catalog serves', () => {
  it('are making a comment, listing the comments, resolving one and reopening one, in a playbook and in the organization', () => {
    expect(
      [...commentOperations, ...orgCommentOperations].map(({ registration: { scope, name } }) => [scope, name]),
    ).toEqual([
      ['playbook', 'make_comment'],
      ['playbook', 'list_comments'],
      ['playbook', 'resolve_comment'],
      ['playbook', 'reopen_comment'],
      ['org', 'make_comment'],
      ['org', 'list_comments'],
      ['org', 'resolve_comment'],
      ['org', 'reopen_comment'],
    ]);
  });
});
