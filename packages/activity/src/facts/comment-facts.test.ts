import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  CommentEventSchema,
  commentDecider,
  commentStreamOf,
  type CommentState,
  type MakeComment,
  type RecordedCommentEvent,
  type ReopenComment,
  type ResolveComment,
} from './comment-facts.ts';

const priya = { id: 'person:user_7kLm2', name: 'Priya Raman' };

const address = 'finance/definitions/workflow/close-the-week/4/steps/do/1/review';

const text = 'Flag any entry over $10,000 for Priya before the week closes.';

const madeAt = { at: '2026-11-02T10:14:03.218Z', by: priya.id };

const resolvedAt = { at: '2026-11-02T11:02:57.640Z', by: 'person:user_3pQr8' };

const anchor = { x: 0.6125, y: 0.4 };

const made: RecordedCommentEvent = {
  type: 'comment_made',
  data: { address, text, made_by: priya, anchor },
  context: madeAt,
};

const madeWithoutAnchor: RecordedCommentEvent = {
  type: 'comment_made',
  data: { address, text, made_by: priya },
  context: madeAt,
};

const reopenedAt = { at: '2026-11-02T11:40:12.005Z', by: priya.id };

const resolved: RecordedCommentEvent = { type: 'comment_resolved', data: { how: 'acted' }, context: resolvedAt };

const reopened: RecordedCommentEvent = { type: 'comment_reopened', data: {}, context: reopenedAt };

const open: CommentState = { address, text, anchor, madeBy: priya, at: madeAt.at, resolution: null, reopening: null };

describe('the facts of a comment', () => {
  recordedFactsBehaviour({
    schema: CommentEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.56.0': [made, resolved, reopened] },
  });
});

const decode = Schema.decodeUnknownResult(CommentEventSchema);

function isAnchoredAt(x: number, y: number): boolean {
  return Result.isSuccess(decode({ ...made, data: { ...made.data, anchor: { x, y } } }));
}

describe('the anchor of a comment', () => {
  it('is read where a comment made without one has none', () => {
    expect(Result.isSuccess(decode(madeWithoutAnchor))).toBe(true);
    expect(commentDecider.evolve(null, madeWithoutAnchor)).toEqual({ ...open, anchor: null });
  });

  it('holds two fractions of the box, each from 0 to 1 with at most 4 decimals', () => {
    expect([isAnchoredAt(0, 1), isAnchoredAt(1, 0.0001)]).toEqual([true, true]);
    expect([
      isAnchoredAt(-0.1, 0.5),
      isAnchoredAt(0.5, 1.0001),
      isAnchoredAt(0.12345, 0.5),
      isAnchoredAt(0.5, Number.NaN),
    ]).toEqual([false, false, false, false]);
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
  const make: MakeComment = { kind: 'make', address, text, anchor, madeBy: priya, ...madeAt };

  it('records what was said, about what, where on it and by whom, as and by whom the caller made it', () => {
    expect(commentDecider.decide(make, null)).toEqual(
      Result.succeed([{ type: 'comment_made', data: { address, text, made_by: priya, anchor } }]),
    );
    expect(commentDecider.context(make, null)).toEqual(madeAt);
  });

  it('records no anchor for a comment made without a pin', () => {
    expect(commentDecider.decide({ ...make, anchor: null }, null)).toEqual(
      Result.succeed([{ type: 'comment_made', data: { address, text, made_by: priya } }]),
    );
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

describe('the decision to reopen a comment', () => {
  const reopen: ReopenComment = { kind: 'reopen', ...reopenedAt };

  it('records the reopening of a resolved comment, which folds to it open again, saying when and by whom', () => {
    const closed = commentDecider.evolve(open, resolved);

    expect(commentDecider.decide(reopen, closed)).toEqual(Result.succeed([{ type: 'comment_reopened', data: {} }]));
    expect(commentDecider.context(reopen, closed)).toEqual(reopenedAt);
    expect(commentDecider.evolve(closed, reopened)).toEqual({ ...open, reopening: reopenedAt });
  });

  it('records nothing for a comment never made, or one open already', () => {
    expect([commentDecider.decide(reopen, null), commentDecider.decide(reopen, open)]).toEqual([
      Result.succeed([]),
      Result.succeed([]),
    ]);
    expect(commentDecider.evolve(null, reopened)).toBeNull();
  });
});
