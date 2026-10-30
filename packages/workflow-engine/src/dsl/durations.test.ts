import { describe, expect, it } from 'vitest';

import { readDuration } from './durations.ts';

describe('a duration', () => {
  it.each([
    ['PT1S', 1000],
    ['PT1.5S', 1500],
    ['PT2M', 120_000],
    ['PT1H30M', 5_400_000],
    ['P1D', 86_400_000],
    ['P1W', 604_800_000],
    ['P1DT1S', 86_401_000],
  ])('reads the ISO 8601 duration %s', (text, milliseconds) => {
    expect(readDuration(text)).toEqual({ milliseconds });
  });

  it('reads an object of units', () => {
    expect(readDuration({ days: 1, hours: 2, minutes: 3, seconds: 4, milliseconds: 5 })).toEqual({
      milliseconds: 93_784_005,
    });
    expect(readDuration({ seconds: 0 })).toEqual({ milliseconds: 0 });
  });

  it.each(['P1Y', 'P2M'])('rejects %s, whose length varies', (text) => {
    expect(readDuration(text)).toEqual({
      problem: `${text} counts years or months, which have no fixed length; use weeks, days or less`,
    });
  });
});

describe('what is not a duration', () => {
  it.each(['soon', 'P'])('is rejected when it is the text %s', (text) => {
    expect(readDuration(text)).toEqual({ problem: `${text} is not an ISO 8601 duration` });
  });

  it('is rejected when it is neither text nor an object, or has odd units', () => {
    expect(readDuration(5)).toEqual({ problem: 'A duration is an ISO 8601 string or an object of units' });
    expect(readDuration({ weeks: 1 })).toEqual({ problem: 'A duration has no unit weeks' });
  });

  it('is rejected when its units are not counts', () => {
    const problem = 'The units of a duration are numbers, none of them negative';

    expect(readDuration({ seconds: -1 })).toEqual({ problem });
    expect(readDuration({ seconds: '1' })).toEqual({ problem });
  });
});
