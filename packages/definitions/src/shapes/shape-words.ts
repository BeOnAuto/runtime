import { alternatives, listed, type Noun } from '@on.auto/operations';

import { named, paragraph, type OverviewBlock, type Phrases } from '../overview/overview.ts';
import { nothing, numbers, text, yesOrNo } from '../overview/schema-nouns.ts';
import { categoriesBounds } from './categories-shape.ts';
import type { OutputShape } from './output-shape.ts';
import type { SeriesGrain } from './period-forms.ts';
import { seriesBounds } from './series-shape.ts';
import { counted } from './shape-values.ts';
import { tableBounds } from './table-shape.ts';
import { textBounds } from './text-shape.ts';

const withLowAndHigh: Phrases = [', with a ', named('low'), ' and a ', named('high'), ' where given'];

const seriesWords: Phrases = [
  'It answers a series over time, in ',
  named('unit'),
  `: 1 to ${seriesBounds.mostLines} lines, one for each `,
  named('name'),
  `, of at most ${counted.format(seriesBounds.mostPoints)} `,
  named('points'),
  ' in all, each a ',
  named('value'),
  ' at its ',
  named('at'),
  ...withLowAndHigh,
  `, and at most ${seriesBounds.mostMarks} `,
  named('marks'),
  ', each a ',
  named('value'),
  ' with a ',
  named('label'),
  '. Each ',
  named('at'),
  ' is a day, week, month, quarter or year, as ',
  named('period'),
  ' names, or a date and time where it names none, and ',
  named('origin'),
  ' is the last one observed.',
];

const categoriesWords: Phrases = [
  `It answers 1 to ${categoriesBounds.mostValues} `,
  named('values'),
  ', in ',
  named('unit'),
  ', each a ',
  named('value'),
  ' under a ',
  named('name'),
  ' of its own',
  ...withLowAndHigh,
  '.',
];

const cellWords = alternatives([text.one, numbers.one, yesOrNo.one, nothing.one]);

const tableWords: Phrases = [
  `It answers a table of 1 to ${tableBounds.mostColumns} `,
  named('columns'),
  ', each a ',
  named('name'),
  ' of its own with a ',
  named('unit'),
  ` where given, and at most ${tableBounds.mostRows} `,
  named('rows'),
  `, each one cell for each column: ${cellWords}.`,
];

const textWords: Phrases = [
  'It answers a ',
  named('text'),
  `: Markdown of at most ${counted.format(textBounds.mostBytes)} bytes.`,
];

const shapeWords: Readonly<Record<OutputShape['name'], Phrases>> = {
  series: seriesWords,
  categories: categoriesWords,
  table: tableWords,
  text: textWords,
};

export const shapeNouns: Readonly<Record<OutputShape['name'], string>> = {
  series: 'a series over time',
  categories: 'values by category',
  table: 'rows under named columns',
  text: 'a text of Markdown',
};

export function shapeBlocks({ name }: OutputShape): readonly OverviewBlock[] {
  return [paragraph(...shapeWords[name])];
}

export const periodNouns: Readonly<Record<SeriesGrain, Noun>> = {
  day: { one: 'day', other: 'days' },
  week: { one: 'week', other: 'weeks' },
  month: { one: 'month', other: 'months' },
  quarter: { one: 'quarter', other: 'quarters' },
  year: { one: 'year', other: 'years' },
};

type PointsAhead = { readonly periods: readonly number[] } | { readonly totalTo: SeriesGrain };

interface SeriesPath {
  readonly period: SeriesGrain;
  readonly observed: number;
  readonly ahead: PointsAhead;
}

function observedWords(period: SeriesGrain, observed: number): string {
  const { one, other } = periodNouns[period];
  if (observed === 0) {
    return '';
  }
  return observed === 1
    ? `the last observed ${one} and `
    : `the last ${counted.format(observed)} observed ${other} and `;
}

function aheadWords(period: SeriesGrain, ahead: PointsAhead): string {
  if ('totalTo' in ahead) {
    return `the total from the next ${period} to the end of its ${ahead.totalTo}, with`;
  }
  const { periods } = ahead;
  const { one, other } = periodNouns[period];
  const noun = periods.length === 1 && periods[0] === 1 ? one : other;
  const each = periods.length === 1 ? 'with' : 'each with';
  return `${listed(periods.toSorted((left, right) => left - right).map((count) => counted.format(count)))} ${noun} ahead, ${each}`;
}

export function seriesPathBlocks({ period, observed, ahead }: SeriesPath): readonly OverviewBlock[] {
  return [
    paragraph(
      `It answers ${observedWords(period, observed)}${aheadWords(period, ahead)} a likely value, a low and a high.`,
    ),
  ];
}
