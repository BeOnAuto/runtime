import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  CommentEventSchema,
  commentDecider,
  commentStreamOf,
  type CommentState,
  type MakeComment,
  type RecordedCommentEvent,
  type ResolveComment,
} from './comment-facts.ts';

const priya = { id: 'person:user_7kLm2', name: 'Priya Raman' };

const address = 'finance/definitions/workflow/close-the-week/4/steps/do/1/review';

const text = 'Flag any entry over $10,000 for Priya before the week closes.';

const madeAt = { at: '2026-11-02T10:14:03.218Z', by: priya.id };

const resolvedAt = { at: '2026-11-02T11:02:57.640Z', by: 'person:user_3pQr8' };

const made: RecordedCommentEvent = { type: 'comment_made', data: { address, text, made_by: priya }, context: madeAt };

const resolved: RecordedCommentEvent = { type: 'comment_resolved', data: { how: 'acted' }, context: resolvedAt };

const open: CommentState = { address, text, madeBy: priya, at: madeAt.at, resolution: null };

describe('the facts of a comment', () => {
  recordedFactsBehaviour({
    schema: CommentEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.56.0': [made, resolved] },
  });
});

describe('the stream of a comment', () => {
  it('is one per comment, named by its id', () => {
    expect(commentStreamOf('019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f')).toBe(
      'comments/019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f',
    );
  });
});

describe('the decision to make a comment', () => {
  const make: MakeComment = { kind: 'make', address, text, madeBy: priya, ...madeAt };

  it('records what was said, about what and by whom, as and by whom the caller made it', () => {
    expect(commentDecider.decide(make, null)).toEqual(
      Result.succeed([{ type: 'comment_made', data: { address, text, made_by: priya } }]),
    );
    expect(commentDecider.context(make, null)).toEqual(madeAt);
  });

  it('records nothing on a stream that holds a comment already', () => {
    expect(commentDecider.decide(make, open)).toEqual(Result.succeed([]));
  });

  it('folds to the comment, open', () => {
    expect(commentDecider.evolve(null, made)).toEqual(open);
  });
});

describe('the decision to resolve a comment', () => {
  const resolve: ResolveComment = { kind: 'resolve', how: 'dismissed', ...resolvedAt };

  it('records how an open comment was resolved', () => {
    expect(commentDecider.decide(resolve, open)).toEqual(
      Result.succeed([{ type: 'comment_resolved', data: { how: 'dismissed' } }]),
    );
  });

  it('records nothing for a comment never made, or one resolved already', () => {
    const closed = commentDecider.evolve(open, resolved);

    expect([commentDecider.decide(resolve, null), commentDecider.decide(resolve, closed)]).toEqual([
      Result.succeed([]),
      Result.succeed([]),
    ]);
    expect(closed).toEqual({ ...open, resolution: { ...resolvedAt, how: 'acted' } });
    expect(commentDecider.evolve(null, resolved)).toBeNull();
  });
});
