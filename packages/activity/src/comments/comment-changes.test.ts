import { changeCatalogOf } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { commentChanges } from './comment-changes.ts';

const id = '019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f';

const context = { at: '2026-11-02T10:14:03.218Z', by: 'person:user_7kLm2' };

describe('the changes a comment makes', () => {
  it('names the comment, by its id, for each comment made, resolved or reopened', () => {
    const catalog = changeCatalogOf([commentChanges]);

    expect(
      ['comment_made', 'comment_resolved', 'comment_reopened', 'comment_edited'].map((type) =>
        catalog.changesOf({ id: 'm1', stream: `comments/${id}`, type, context }),
      ),
    ).toEqual([
      [{ kind: 'comment', comment_id: id }],
      [{ kind: 'comment', comment_id: id }],
      [{ kind: 'comment', comment_id: id }],
      [],
    ]);
  });
});
