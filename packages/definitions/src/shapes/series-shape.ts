import type { SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { amount, closedRecord, highest, label, lowest, shapeOf, type OutputShape } from './output-shape.ts';
import { grains, timelineIn, type Timeline } from './period-forms.ts';
import {
  counted,
  issueAt,
  itemsOf,
  rangeIssues,
  recordOf,
  repeatedNameIssues,
  textValue,
  type Path,
} from './shape-values.ts';

const seriesBounds = { mostLines: 20, mostPoints: 2_000, mostMarks: 8 } as const;

const point = closedRecord(
  {
    at: {
      type: 'string',
      description:
        'When the point is: the period in the ISO 8601 form of the grain period names, YYYY-MM-DD, YYYY-Www, YYYY-MM, YYYY-Qn or YYYY, or an RFC 3339 date and time when period is left out; later than the point before it',
    },
    value: amount,
    low: lowest,
    high: highest,
  },
  ['at', 'value'],
);

const line = closedRecord({ name: label, points: { type: 'array', items: point, maxItems: seriesBounds.mostPoints } }, [
  'name',
  'points',
]);

const mark = closedRecord({ label, value: amount }, ['label', 'value']);

export const seriesMarksSchema = {
  type: 'array',
  items: mark,
  maxItems: seriesBounds.mostMarks,
} satisfies Schema.JsonObject;

function orderIssues(points: readonly Schema.Json[], path: Path, timeline: Timeline): readonly SchemaIssue[] {
  let last: number | undefined;
  return points.flatMap((entry, index) => {
    const at = textValue(recordOf(entry)['at']);
    if (at === undefined) {
      return [];
    }
    const moment = timeline.momentOf(at);
    if (moment === undefined) {
      return [issueAt([...path, index, 'at'], `Expected ${timeline.words}`)];
    }
    const before = last;
    last = moment;
    return before !== undefined && moment <= before
      ? [issueAt([...path, index, 'at'], 'Expected a time later than the point before it')]
      : [];
  });
}

function lineIssues(entry: Schema.Json, index: number, timeline: Timeline | undefined): readonly SchemaIssue[] {
  const points = itemsOf(recordOf(entry)['points']);
  const path = ['lines', index, 'points'];
  return [
    ...points.flatMap((each, at) => rangeIssues(each, [...path, at])),
    ...(timeline === undefined ? [] : orderIssues(points, path, timeline)),
  ];
}

function originIssues(origin: Schema.Json | undefined, timeline: Timeline | undefined): readonly SchemaIssue[] {
  const at = textValue(origin);
  if (at === undefined || timeline === undefined || timeline.momentOf(at) !== undefined) {
    return [];
  }
  return [issueAt(['origin'], `Expected ${timeline.words}`)];
}

function totalIssues(lines: readonly Schema.Json[]): readonly SchemaIssue[] {
  const points = lines.reduce<number>((sum, entry) => sum + itemsOf(recordOf(entry)['points']).length, 0);
  return points > seriesBounds.mostPoints
    ? [issueAt(['lines'], `Expected at most ${counted.format(seriesBounds.mostPoints)} points across the lines`)]
    : [];
}

function seriesIssues(value: Schema.Json): readonly SchemaIssue[] {
  const series = recordOf(value);
  const timeline = timelineIn(series['period']);
  const lines = itemsOf(series['lines']);
  return [
    ...originIssues(series['origin'], timeline),
    ...repeatedNameIssues(lines, ['lines'], 'line'),
    ...lines.flatMap((entry, index) => lineIssues(entry, index, timeline)),
    ...totalIssues(lines),
  ];
}

export const seriesShape: OutputShape = shapeOf({
  name: 'series',
  properties: {
    unit: label,
    period: {
      type: 'string',
      enum: [...grains],
      description: 'The grain of every at: day, week, month, quarter or year',
    },
    origin: { type: 'string', description: 'The at of the last point observed, in the form of at' },
    lines: { type: 'array', items: line, minItems: 1, maxItems: seriesBounds.mostLines },
    marks: seriesMarksSchema,
  },
  required: ['lines'],
  further: seriesIssues,
});
