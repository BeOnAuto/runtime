const aMinute = 60_000;

const anHour = 60 * aMinute;

const aDay = 24 * anHour;

const aWeek = 7 * aDay;

const shortestDuration = aMinute;

const longestDuration = 90 * aDay;

const exactDuration =
  /^P(?!$)(?:(?<weeks>\d+)W)?(?:(?<days>\d+)D)?(?:T(?=\d)(?:(?<hours>\d+)H)?(?:(?<minutes>\d+)M)?)?$/u;

export function exactDurationOf(text: string): number | undefined {
  const groups = exactDuration.exec(text)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const amountOf = (unit: string) => Number(groups[unit] ?? 0);
  return (
    amountOf('weeks') * aWeek + amountOf('days') * aDay + amountOf('hours') * anHour + amountOf('minutes') * aMinute
  );
}

export function isWithinTheDurations(milliseconds: number): boolean {
  return milliseconds >= shortestDuration && milliseconds <= longestDuration;
}
