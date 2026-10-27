import { describe, expect, it } from 'vitest';

import { isKnownTimeZone, zoneClockOf } from './zone-clock.ts';

function at(text: string): number {
  return Date.parse(text);
}

describe('a time zone', () => {
  it('is known when the platform has its zone data under an IANA name, which an offset is not', () => {
    expect([
      isKnownTimeZone('America/New_York'),
      isKnownTimeZone('UTC'),
      isKnownTimeZone('Etc/GMT+5'),
      isKnownTimeZone('US/Eastern'),
      isKnownTimeZone('+05:00'),
      isKnownTimeZone('-00:00'),
      isKnownTimeZone('Mars/Olympus'),
      isKnownTimeZone('Europe/London '),
      isKnownTimeZone(''),
    ]).toEqual([true, true, true, true, false, false, false, false, false]);
  });
});

describe('the wall-clock time of a time zone', () => {
  it('is the time its clocks show at an instant, to the millisecond', () => {
    const newYork = zoneClockOf('America/New_York');

    expect([
      newYork.wallClockAt(at('2026-03-08T06:59:59.999Z')),
      newYork.wallClockAt(at('2026-03-08T07:00:00.000Z')),
      newYork.wallClockAt(at('2026-11-01T05:30:00.000Z')),
      newYork.wallClockAt(at('2026-11-01T06:30:00.000Z')),
    ]).toEqual([
      at('2026-03-08T01:59:59.999Z'),
      at('2026-03-08T03:00:00.000Z'),
      at('2026-11-01T01:30:00.000Z'),
      at('2026-11-01T01:30:00.000Z'),
    ]);
  });

  it('is first reached at its one instant, at the first of two in an hour that repeats, and where a skipped hour ends', () => {
    const newYork = zoneClockOf('America/New_York');
    const lordHowe = zoneClockOf('Australia/Lord_Howe');

    expect([
      newYork.firstInstantReaching(at('2026-06-01T06:00:00.000Z')),
      newYork.firstInstantReaching(at('2026-11-01T01:30:00.000Z')),
      newYork.firstInstantReaching(at('2026-03-08T02:30:00.000Z')),
      newYork.firstInstantReaching(at('2026-03-08T02:00:00.000Z')),
      lordHowe.firstInstantReaching(at('2026-10-04T02:15:00.000Z')),
      zoneClockOf('UTC').firstInstantReaching(at('2026-03-08T02:30:00.000Z')),
    ]).toEqual([
      at('2026-06-01T10:00:00.000Z'),
      at('2026-11-01T05:30:00.000Z'),
      at('2026-03-08T07:00:00.000Z'),
      at('2026-03-08T07:00:00.000Z'),
      at('2026-10-03T15:30:00.000Z'),
      at('2026-03-08T02:30:00.000Z'),
    ]);
  });
});
