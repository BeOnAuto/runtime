import { entriesOf, isObject, type Json, type JsonEntry, type JsonObject } from './json.ts';

export type DurationReading = { readonly milliseconds: number } | { readonly problem: string };

type UnitFactor = readonly [string, number];

const millisecondsPerInlineUnit: readonly UnitFactor[] = [
  ['days', 86_400_000],
  ['hours', 3_600_000],
  ['minutes', 60_000],
  ['seconds', 1000],
  ['milliseconds', 1],
];

const millisecondsPerIsoUnit: readonly UnitFactor[] = [
  ['weeks', 604_800_000],
  ['days', 86_400_000],
  ['hours', 3_600_000],
  ['minutes', 60_000],
  ['seconds', 1000],
];

const isoDuration =
  /^P(?!$)(?:(?<years>\d+(?:\.\d+)?)Y)?(?:(?<months>\d+(?:\.\d+)?)M)?(?:(?<weeks>\d+(?:\.\d+)?)W)?(?:(?<days>\d+(?:\.\d+)?)D)?(?:T(?=\d)(?:(?<hours>\d+(?:\.\d+)?)H)?(?:(?<minutes>\d+(?:\.\d+)?)M)?(?:(?<seconds>\d+(?:\.\d+)?)S)?)?$/u;

const inlineUnits = new Set(millisecondsPerInlineUnit.map(([unit]) => unit));

export function readDuration(value: Json): DurationReading {
  if (typeof value === 'string') {
    return fromIso(value);
  }
  return isObject(value) ? fromInline(value) : { problem: 'A duration is an ISO 8601 string or an object of units' };
}

function fromIso(text: string): DurationReading {
  const groups = isoDuration.exec(text)?.groups;
  if (groups === undefined) {
    return { problem: `${text} is not an ISO 8601 duration` };
  }
  if (groups['years'] !== undefined || groups['months'] !== undefined) {
    return { problem: `${text} counts years or months, which have no fixed length; use weeks, days or less` };
  }
  return {
    milliseconds: Math.round(
      millisecondsPerIsoUnit.reduce(
        (total, [unit, factor]: UnitFactor) => total + Number(groups[unit] ?? 0) * factor,
        0,
      ),
    ),
  };
}

function fromInline(duration: JsonObject): DurationReading {
  const entries = entriesOf(duration);
  const unknownUnit = entries.find(([unit]) => !inlineUnits.has(unit));
  if (unknownUnit !== undefined) {
    return { problem: `A duration has no unit ${unknownUnit[0]}` };
  }
  if (!entries.every(([, amount]: JsonEntry) => typeof amount === 'number' && amount >= 0)) {
    return { problem: 'The units of a duration are numbers, none of them negative' };
  }
  return {
    milliseconds: millisecondsPerInlineUnit.reduce((total, [unit, factor]: UnitFactor) => {
      const amount = duration[unit];
      return total + (typeof amount === 'number' ? amount * factor : 0);
    }, 0),
  };
}
