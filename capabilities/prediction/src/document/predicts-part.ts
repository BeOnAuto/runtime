import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';

import { figure } from '../capability/figures.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import { longestSpanOf } from '../periods/enclosing.ts';
import { checkedFrom, isWhole, nameIssues, refusedAt, type Checked } from './checked-parts.ts';
import type { WrittenData, WrittenPredicts } from './front-matter.ts';
import type { Predicts } from './prediction-document.ts';

const {
  mostHorizons,
  mostHorizon,
  leastSeason,
  mostSeason,
  mostUnitCharacters,
  mostHistory,
  mostWindow,
  leastCoverage,
  mostCoverage,
  coverage: usualCoverage,
} = predictionBounds;

const summedPairs =
  'a day sums to a week, a month or a quarter, a week to a quarter or a year, and a month to a quarter or a year';

function seasonIssues(season: number | undefined, lines: SourceLines): readonly DocumentIssue[] {
  return season === undefined || isWhole(season, leastSeason, mostSeason)
    ? []
    : refusedAt(
        lines,
        '/predicts/season',
        `A season is a whole number of periods from ${leastSeason} to ${mostSeason}, not ${figure(season)}; leave it out when the series has none`,
      );
}

function horizonIssues(horizons: readonly number[], lines: SourceLines): readonly DocumentIssue[] {
  if (horizons.length === 0 || horizons.length > mostHorizons) {
    return refusedAt(
      lines,
      '/predicts/horizons',
      `A prediction function names 1 to ${mostHorizons} horizons; it names ${figure(horizons.length)}`,
    );
  }
  return horizons.flatMap((horizon, index) => {
    const pointer = `/predicts/horizons/${index}`;
    if (!isWhole(horizon, 1, mostHorizon)) {
      return refusedAt(
        lines,
        pointer,
        `A horizon is a whole number of periods from 1 to ${mostHorizon}, not ${figure(horizon)}`,
      );
    }
    return horizons.indexOf(horizon) < index
      ? refusedAt(lines, pointer, `The horizon ${horizon} is named more than once; name each horizon once`)
      : [];
  });
}

function accumulationIssues(
  { period, accumulates, horizons }: WrittenPredicts,
  target: WrittenData['target'],
  lines: SourceLines,
): readonly DocumentIssue[] {
  if (accumulates === undefined) {
    return horizons === undefined
      ? refusedAt(lines, '/predicts', 'predicts names its horizons, or accumulates in their place')
      : horizonIssues(horizons, lines);
  }
  if (horizons !== undefined) {
    return refusedAt(
      lines,
      '/predicts/horizons',
      'accumulates takes the place of horizons, since a total to the end of a period asks no horizon; name one or the other',
    );
  }
  if (longestSpanOf(period, accumulates) === undefined) {
    return refusedAt(lines, '/predicts/accumulates', `A ${period} does not sum to a ${accumulates}: ${summedPairs}`);
  }
  return target === undefined || target.as === 'count' || target.as === 'sum'
    ? []
    : refusedAt(
        lines,
        '/data/target/as',
        `A total to the end of a ${accumulates} is a count or a sum; a sum of ${target.as} values says nothing`,
      );
}

function unitIssues(unit: string, lines: SourceLines): readonly DocumentIssue[] {
  return unit.trim() === '' || unit.length > mostUnitCharacters
    ? refusedAt(lines, '/predicts/unit', `The unit is text of 1 to ${mostUnitCharacters} characters, such as orders`)
    : [];
}

function historyIssues(history: number | undefined, window: number, lines: SourceLines): readonly DocumentIssue[] {
  const at = '/predicts/history';
  if (history === undefined) {
    return [];
  }
  if (!isWhole(history, 0, mostHistory)) {
    return refusedAt(
      lines,
      at,
      `The history is a whole number of periods from 0 to ${mostHistory}, not ${figure(history)}; leave it out for twice the longest horizon`,
    );
  }
  return history > window
    ? refusedAt(
        lines,
        at,
        `The history of ${figure(history)} periods is more than the window of ${figure(window)}, which a question reads it from`,
      )
    : [];
}

function coverageIssues(coverage: number, lines: SourceLines): readonly DocumentIssue[] {
  return coverage >= leastCoverage && coverage <= mostCoverage
    ? []
    : refusedAt(
        lines,
        '/predicts/coverage',
        `The coverage is a share from ${leastCoverage} to ${mostCoverage}, not ${figure(coverage)}; leave it out for ${usualCoverage}`,
      );
}

type Reach = Pick<Predicts, 'period' | 'horizons' | 'accumulates'>;

function longestHorizonOf({ period, horizons, accumulates }: Reach): number {
  return accumulates === undefined ? Math.max(...horizons) : Number(longestSpanOf(period, accumulates));
}

const pastTotalsBackTested = 3;

function leastWindowOf(reach: Reach): { readonly least: number; readonly words: string } {
  const longest = longestHorizonOf(reach);
  if (reach.accumulates === undefined) {
    return {
      least: longest + pastTotalsBackTested,
      words: `the longest horizon and ${pastTotalsBackTested} more, which the forecaster needs to backtest an answer ${figure(longest)} periods ahead`,
    };
  }
  return {
    least: (pastTotalsBackTested + 1) * longest,
    words: `${pastTotalsBackTested + 1} times the ${figure(longest)} periods a ${reach.accumulates} holds at most, which the forecaster needs to backtest a total at ${pastTotalsBackTested} past ${reach.accumulates}s`,
  };
}

function windowIssues(window: number, reach: Reach, lines: SourceLines): readonly DocumentIssue[] {
  const at = '/data/window';
  if (!isWhole(window, 1, mostWindow)) {
    return refusedAt(
      lines,
      at,
      `The window is a whole number of periods, at most ${figure(mostWindow)}, not ${figure(window)}`,
    );
  }
  const { least, words } = leastWindowOf(reach);
  return window < least
    ? refusedAt(lines, at, `The window of ${figure(window)} periods is under ${figure(least)}, ${words}`)
    : [];
}

export function predictsOf(written: WrittenPredicts, data: WrittenData, lines: SourceLines): Checked<Predicts> {
  const { target: name, period, season, horizons = [], accumulates, unit, history, coverage = usualCoverage } = written;
  const reach: Reach = { period, horizons, ...(accumulates === undefined ? {} : { accumulates }) };
  const reached = accumulationIssues(written, data.target, lines);
  const issues = [
    ...nameIssues(name, lines, '/predicts/target'),
    ...seasonIssues(season, lines),
    ...reached,
    ...(reached.length === 0 ? windowIssues(data.window, reach, lines) : []),
    ...unitIssues(unit, lines),
    ...historyIssues(history, data.window, lines),
    ...coverageIssues(coverage, lines),
  ];
  return checkedFrom(issues, () => ({
    target: name,
    ...(season === undefined ? {} : { season }),
    ...reach,
    unit: unit.trim(),
    history: history ?? 2 * longestHorizonOf(reach),
    coverage,
  }));
}
