const exactDuration = /^P(?:(?<weeks>\d+)W)?(?:(?<days>\d+)D)?(?:T(?=\d)(?:(?<hours>\d+)H)?(?:(?<minutes>\d+)M)?)?$/u;

const aMinute = 60_000;

export const anHour = 60 * aMinute;

export const aDay = 24 * anHour;

const aWeek = 7 * aDay;

export function utcMidnightAtOrAfter(at: number): number {
  return Math.ceil(at / aDay) * aDay;
}

export function utcMidnightAfter(at: number): number {
  return utcMidnightAtOrAfter(at + 1);
}

function countOf(text: string | undefined): number {
  return text === undefined ? 0 : Number(text);
}

export function exactDurationMsOf(text: string): number | undefined {
  const groups = text === 'P' ? undefined : exactDuration.exec(text)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  return (
    countOf(groups['weeks']) * aWeek +
    countOf(groups['days']) * aDay +
    countOf(groups['hours']) * anHour +
    countOf(groups['minutes']) * aMinute
  );
}

export function graceMsOf(grace?: string): number {
  return exactDurationMsOf(grace ?? 'PT1H') ?? anHour;
}
