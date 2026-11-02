import { changingOne, changeKindOf, type ChangeNaming, type PlacedFact } from '@on.auto/operations';

import { commentStreamKind, commentStreamOf } from '../facts/comment-facts.ts';

const commentChanged = changeKindOf('comment', 'A comment made, resolved or reopened', {
  comment_id: 'The id of the comment',
});

function commentChangedBy({ stream }: PlacedFact) {
  return [commentChanged.of({ comment_id: stream.slice(commentStreamOf('').length) })];
}

export const commentChanges: ChangeNaming = {
  streamKind: commentStreamKind,
  changes: changingOne(commentChanged, ['comment_made', 'comment_resolved', 'comment_reopened'], commentChangedBy),
};
