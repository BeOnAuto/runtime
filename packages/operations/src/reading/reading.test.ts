import { Buffer } from 'node:buffer';

import { Option, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  boundedPage,
  defaultPageLimit,
  type Examined,
  isCalendarDay,
  mostBytesLoadedInAPage,
  mostPublicEventDataBytes,
  PagingInputFields,
  PagingOutputFields,
  PublicEventSchema,
  WholeEventSchema,
} from '../index.ts';
import { cursorOfParts, cursorWithin, insideOf, partsOfCursor } from './cursor-parts.ts';

describe('a day of the calendar', () => {
  it.each(['2026-10-06', '2024-02-29', '2026-12-31', '0001-01-01'])('is %s', (day) => {
    expect(isCalendarDay(day)).toBe(true);
  });

  it.each(['2026-02-30', '2025-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-6', '20261006', ''])(
    'is not %j, which does not name the same day when read back',
    (day) => {
      expect(isCalendarDay(day)).toBe(false);
    },
  );
});

const record = cursorOfParts(['playbook/acme/alpha/', '42']);

describe('a cursor', () => {
  it('is the base64url encoding of a JSON array of its parts', () => {
    expect(record).toBe(Buffer.from(JSON.stringify(['playbook/acme/alpha/', '42'])).toString('base64url'));
    expect(partsOfCursor(record)).toEqual(Option.some(['playbook/acme/alpha/', '42']));
    expect(partsOfCursor('not a cursor')).toEqual(Option.none());
  });

  it('points inside a record with one more part, the index of the last event of the record answered', () => {
    const inside = cursorWithin(record, 3);

    expect(partsOfCursor(inside)).toEqual(Option.some(['playbook/acme/alpha/', '42', 3]));
    expect(insideOf(inside)).toEqual({ record, index: 3 });
  });

  it('points inside no record when it is a record of its own, none at all, or no cursor', () => {
    expect([insideOf(record), insideOf(), insideOf('not a cursor')]).toEqual([undefined, undefined, undefined]);
    expect(cursorWithin('not a cursor', 3)).toBe('not a cursor');
  });
});

const decodeEvent = Schema.decodeUnknownResult(PublicEventSchema);

const decodeWholeEvent = Schema.decodeUnknownResult(WholeEventSchema);

function eventWithData(bytes: number) {
  const free = bytes - JSON.stringify({ text: '' }).length;
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    type: 'run_started',
    summary: 'A run of the summary reasoning started',
    data: { text: `${'é'.repeat(Math.floor(free / 2))}${'a'.repeat(free % 2)}` },
    metadata: {
      stream: 'playbook/acme/sales/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      position: 1,
      global_position: 42,
      correlation_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      causation_id: null,
      at: '2026-10-05T09:00:00.000Z',
      by: 'playbook:sales',
      run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      definition: { type: 'reasoning', name: 'summary', version: 2 },
    },
  };
}

describe('a public event', () => {
  it('carries data of up to 4 KiB as JSON in UTF-8', () => {
    const largest = eventWithData(mostPublicEventDataBytes);

    expect(decodeEvent(largest)).toEqual(Result.succeed(largest));
  });

  it('is refused with data of more than 4 KiB', () => {
    expect(Result.isFailure(decodeEvent(eventWithData(mostPublicEventDataBytes + 1)))).toBe(true);
  });

  it('read whole carries data of any size', () => {
    const large = eventWithData(mostPublicEventDataBytes * 4);

    expect(decodeWholeEvent(large)).toEqual(Result.succeed(large));
  });
});

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

const mebibyte = 1024 * 1024;

function examined(...items: readonly (readonly [wanted: boolean, size: number])[]): readonly Examined[] {
  return items.map(([wanted, size], index) => ({ examined: index + 1, wanted, size }));
}

const wantedOnes = examined([true, 1], [true, 1], [true, 1], [true, 1]);

describe('a page bounded by what the store examines', () => {
  it('delivers the wanted items up to its limit, and resumes after the last one it examined', () => {
    expect(boundedPage(wantedOnes, 3, 3)).toEqual({
      delivered: wantedOnes.slice(0, 3),
      resumeAfter: wantedOnes[2],
      lastExamined: wantedOnes[2],
    });
  });

  it('has nothing to resume after once it examined all there is, and names the last item it examined', () => {
    expect(boundedPage(wantedOnes.slice(0, 2), 3, 3)).toEqual({
      delivered: wantedOnes.slice(0, 2),
      resumeAfter: undefined,
      lastExamined: wantedOnes[1],
    });
  });
});

describe('the last item a page examined', () => {
  it('is named at the end of what there is, even one it does not want', () => {
    const passedOver = examined([true, 1], [false, 0], [false, 0]);

    expect(boundedPage(passedOver, 3, 3)).toEqual({
      delivered: passedOver.slice(0, 1),
      resumeAfter: undefined,
      lastExamined: passedOver[2],
    });
    expect(boundedPage([], 3, 3)).toEqual({ delivered: [], resumeAfter: undefined, lastExamined: undefined });
  });

  it('passes over what it does not want, and resumes after it even when it delivers nothing', () => {
    const unwanted = examined([false, 0], [false, 0], [false, 0], [true, 1]);

    expect(boundedPage(unwanted, 3, 3)).toEqual({ delivered: [], resumeAfter: unwanted[2], lastExamined: unwanted[2] });
  });

  it('stops before the item that would load more than 4 MiB, but always delivers the first it wants', () => {
    const large = examined([false, 0], [true, 1.5 * mebibyte], [true, 1.5 * mebibyte], [true, 1.5 * mebibyte]);
    const huge = examined([true, 2 * mostBytesLoadedInAPage], [true, 1]);

    expect(boundedPage(large, 20, 20)).toEqual({
      delivered: large.slice(1, 3),
      resumeAfter: large[2],
      lastExamined: large[2],
    });
    expect(boundedPage(huge, 20, 20)).toEqual({
      delivered: huge.slice(0, 1),
      resumeAfter: huge[0],
      lastExamined: huge[0],
    });
  });

  it('examines no more than it may, and resumes after the last item it was allowed to examine', () => {
    const rare = examined([false, 0], [true, 1], [false, 0], [true, 1]);

    expect(boundedPage(rare, 20, 3)).toEqual({
      delivered: rare.slice(1, 2),
      resumeAfter: rare[2],
      lastExamined: rare[2],
    });
  });
});
