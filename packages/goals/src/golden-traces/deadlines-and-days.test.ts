import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import type { GoalRule } from '../goal-rules/goal-rule.ts';
import { traceBookOf, type TraceBook } from './trace-book.ts';
import { wordsOf } from './trace-words.ts';

const day = (offset: number, hour = 0, minute = 0) => Date.UTC(2026, 10, 9 + offset, hour, minute);

const replies: GoalRule = {
  id: 'catering-replies',
  per: 'request',
  window: { after: 'received', for: 'P1D', grace: 'PT1H' },
  success: { settles: 'at_close', target: { at_most: 24 } },
  milestones: [
    { id: 'received', label: 'Request received', by: 'auto' },
    { id: 'decided', label: 'Katy decides', by: 'person' },
    { id: 'answered', label: 'Answer sent', by: 'auto' },
  ],
  notify: { passed: 'quiet', failed: 'now', overdue: 'quiet' },
};

const harbour = assessmentIdOf({ goal: 'catering-replies', per: 'harbour-bookshop' });

const named = { [harbour]: 'Harbour' };

const received = (book: TraceBook, at: number) =>
  book
    .run({ at, entry: { per_id: '/id', marks: 'received' }, output: { id: 'harbour-bookshop' } })
    .map((appended) => wordsOf(appended, named));

const answered = (book: TraceBook, at: number, hours: number) =>
  book
    .run({
      at,
      entry: { per_id: '/id', marks: 'answered', measures: '/hours', final: true, as_of: '/at' },
      output: { id: 'harbour-bookshop', hours, at: new Date(at).toISOString() },
    })
    .map((appended) => wordsOf(appended, named));

const rung = (book: TraceBook, at: number) => book.ring(at).map((appended) => wordsOf(appended, named));

describe('a request answered after its close', () => {
  it('is missed with its number as soon as an answer comes after its close and over the target', () => {
    const book = traceBookOf(replies, day(-1));
    received(book, day(0, 9));

    expect(rung(book, day(1, 10))).toEqual(['Harbour overdue quiet']);
    expect(answered(book, day(1, 10, 20), 25.33)).toEqual([
      'Harbour observed marks answered 25.33 final',
      'Harbour assessed failed final now',
    ]);
    expect(rung(book, day(2, 10))).toEqual([]);
    expect(book.state(harbour)).toMatchObject({
      verdict: 'failed',
      verdictAt: day(1, 10, 20),
      verdictBy: 'final',
      lateMeasurement: { value: 25.33, as_of: day(1, 10, 20) },
    });
    expect(book.state(harbour).finalMeasurement).toBeUndefined();
  });

  it('keeps its miss and gains its number when the answer comes after it was missed', () => {
    const book = traceBookOf(replies, day(-1));
    received(book, day(0, 9));
    rung(book, day(1, 10));
    rung(book, day(2, 10));

    expect(answered(book, day(3, 8), 71)).toEqual(['Harbour observed marks answered 71 final']);
    expect(book.state(harbour)).toMatchObject({
      verdict: 'failed',
      verdictAt: day(1, 10),
      verdictBy: 'deadline',
      lateMeasurement: { value: 71, as_of: day(3, 8) },
    });
    expect(answered(book, day(3, 9), 72)).toEqual(['Harbour observed 72 final']);
    expect(book.state(harbour)).toMatchObject({ verdictBy: 'deadline', lateMeasurement: { value: 72 } });
  });

  it('is still missed by its deadline when an answer after its close is within the target, and keeps that number', () => {
    const book = traceBookOf({ ...replies, success: { settles: 'at_close', target: { at_most: 30 } } }, day(-1));
    received(book, day(0, 9));
    rung(book, day(1, 10));

    expect(answered(book, day(1, 12), 27)).toEqual(['Harbour observed marks answered 27 final']);
    expect(rung(book, day(2, 10))).toEqual(['Harbour assessed failed deadline now']);
    expect(book.state(harbour)).toMatchObject({
      verdictBy: 'deadline',
      lateMeasurement: { value: 27, as_of: day(1, 12) },
    });
  });
});

describe('a request whose deadline passed without an answer', () => {
  it('is missed by its deadline when no answer ever comes', () => {
    const book = traceBookOf(replies, day(-1));
    received(book, day(0, 9));
    rung(book, day(1, 10));

    expect(rung(book, day(2, 10))).toEqual(['Harbour assessed failed deadline now']);
  });

  it('still passes when its answer was given in time and only reported after the due', () => {
    const book = traceBookOf(replies, day(-1));
    received(book, day(0, 9));
    rung(book, day(1, 10));

    expect(
      book
        .run({
          at: day(1, 12),
          entry: { per_id: '/id', marks: 'answered', measures: '/hours', final: true, as_of: '/at' },
          output: { id: 'harbour-bookshop', hours: 20, at: new Date(day(1, 5)).toISOString() },
        })
        .map((appended) => wordsOf(appended, named)),
    ).toEqual(['Harbour observed marks answered 20 final', 'Harbour assessed passed final quiet']);
    expect(book.state(harbour).verdictBy).toBe('final');
  });
});

describe('a request whose deadline has not passed', () => {
  it('stays open, neither passed nor missed', () => {
    const book = traceBookOf(replies, day(-1));
    received(book, day(0, 9));

    expect(rung(book, day(1, 9, 59))).toEqual([]);
    expect(book.state(harbour)).toMatchObject({ verdict: 'open' });
  });
});

const stock: GoalRule = {
  id: 'coffee-stock',
  window: { calendar: 'day', grace: 'PT1H', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
  success: { settles: 'at_close', target: { at_least: 14 } },
};

const dayNamed = Object.fromEntries(
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'next Monday'].map((name, offset) => [
    assessmentIdOf({ goal: 'coffee-stock', window_start: day(offset) }),
    name,
  ]),
);

const counted = (book: TraceBook, at: number, value: number) =>
  book
    .run({
      at,
      entry: { measures: '/v', final: true, as_of: '/at' },
      output: { v: value, at: new Date(at).toISOString() },
    })
    .map((appended) => wordsOf(appended, dayNamed));

describe('a daily goal judged on weekdays only', () => {
  it('opens no window on Saturday or Sunday, and a count taken then appends nothing', () => {
    const book = traceBookOf(stock, day(-1, 12));
    const ringing = (offset: number, hour = 0) =>
      book.ring(day(offset, hour)).map((appended) => wordsOf(appended, dayNamed));

    expect(ringing(4)).toEqual(['Friday assessment_opened due 2026-11-14T01:00:00.000Z']);
    expect(counted(book, day(4, 8), 16)).toEqual(['Friday observed 16 final']);
    expect(ringing(5, 1)).toEqual(['Friday assessed passed final quiet']);
    expect(ringing(5, 2)).toEqual([]);
    expect(counted(book, day(5, 8), 15)).toEqual([]);
    expect(ringing(6, 12)).toEqual([]);
    expect(ringing(7)).toEqual(['next Monday assessment_opened due 2026-11-17T01:00:00.000Z']);
    expect(book.assessments().map((id) => dayNamed[id])).toEqual(['Friday', 'next Monday']);
  });

  it('misses a weekday whose count never came', () => {
    const book = traceBookOf(stock, day(-1, 12));
    book.ring(day(4));
    book.ring(day(5, 1));

    expect(book.ring(day(6, 1)).map((appended) => wordsOf(appended, dayNamed))).toEqual([
      'Friday assessed failed deadline quiet',
    ]);
  });
});
