import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { PagingInputFields, PagingOutputFields, defaultPageLimit } from '../index.ts';

const decodeInput = Schema.decodeUnknownResult(Schema.Struct(PagingInputFields));

const encodeOutput = Schema.encodeUnknownSync(Schema.Struct(PagingOutputFields));

describe('the paging fields of an input', () => {
  it('take a limit, a cursor, an order, a time to start from and a type, each of them optional', () => {
    const paging = {
      limit: 100,
      cursor: 'WyJicmFpbi',
      order: 'desc',
      since: '2026-10-05T09:00:00Z',
      type: 'run_started',
    };

    expect(decodeInput(paging)).toEqual(Result.succeed(paging));
    expect(decodeInput({ since: '2026-10-05T09:00:00.123+02:00' })).toEqual(
      Result.succeed({ since: '2026-10-05T09:00:00.123+02:00' }),
    );
    expect(decodeInput({})).toEqual(Result.succeed({}));
    expect(defaultPageLimit).toBe(20);
  });

  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 2.5 },
    { cursor: '' },
    { cursor: 'c'.repeat(513) },
    { order: 'newest' },
    { since: 'yesterday' },
    { since: '2026-10-05' },
    { since: '2026-13-05T09:00:00Z' },
    { since: '2026-02-30T09:00:00Z' },
    { since: '2026-04-31T09:00:00+02:00' },
    { since: '2026-10-05T24:00:00Z' },
    { since: '2026-10-05T23:59:00+24:00' },
    { type: '' },
  ] as const)('refuse %j', (paging) => {
    expect(Result.isFailure(decodeInput(paging))).toBe(true);
  });
});

describe('the paging fields of an output', () => {
  it('say whether more remains and give the cursor of the page after, or null', () => {
    expect(encodeOutput({ has_more: true, next_cursor: 'WyJicmFpbi' })).toEqual({
      has_more: true,
      next_cursor: 'WyJicmFpbi',
    });
    expect(encodeOutput({ has_more: false, next_cursor: null })).toEqual({ has_more: false, next_cursor: null });
  });
});
