const aDay = 86_400_000;

const aSecond = 1000;

const anOffset = /^[+-]/u;

export interface ZoneClock {
  readonly wallClockAt: (instant: number) => number;
  readonly firstInstantReaching: (wallClock: number) => number;
}

export type InZone = (timeZone: string) => ZoneClock;

function formatIn(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
}

export function isKnownTimeZone(name: string): boolean {
  try {
    return !anOffset.test(formatIn(name).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

function wallClockIn(format: Intl.DateTimeFormat, instant: number): number {
  const parts = format.formatToParts(instant);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part: Readonly<Intl.DateTimeFormatPart>) => part.type === type)?.value);
  return Date.UTC(
    valueOf('year'),
    valueOf('month') - 1,
    valueOf('day'),
    valueOf('hour'),
    valueOf('minute'),
    valueOf('second'),
    instant % aSecond,
  );
}

function firstReaching(isReached: (instant: number) => boolean, before: number, reached: number): number {
  if (reached - before <= 1) {
    return reached;
  }
  const middle = Math.floor((before + reached) / 2);
  return isReached(middle) ? firstReaching(isReached, before, middle) : firstReaching(isReached, middle, reached);
}

export function zoneClockOf(timeZone: string): ZoneClock {
  const format = formatIn(timeZone);
  const wallClockAt = (instant: number) => wallClockIn(format, instant);
  const offsetAt = (instant: number) => wallClockAt(instant) - instant;
  return {
    wallClockAt,
    firstInstantReaching: (wallClock) => {
      const offsetAfter = offsetAt(wallClock + aDay);
      const candidates = [wallClock - offsetAt(wallClock - aDay), wallClock - offsetAfter];
      const showing = candidates.filter((instant) => wallClockAt(instant) === wallClock);
      return showing.length > 0
        ? Math.min(...showing)
        : firstReaching(
            (instant) => offsetAt(instant) === offsetAfter,
            Math.min(...candidates),
            Math.max(...candidates),
          );
    },
  };
}
