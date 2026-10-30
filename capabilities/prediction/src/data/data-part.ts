import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';
import { Result } from 'effect';

import { checkedFrom, refusedAt, type Checked } from '../document/checked-parts.ts';
import type { WrittenData } from '../document/front-matter.ts';
import type { DataExpression, DataPart, DatasetFilter, Feature } from '../document/prediction-document.ts';
import { expressionsOf, filtersOf } from './data-filters.ts';
import {
  featureNameIssues,
  featuresOf,
  givenIssues,
  measureIssues,
  namedFeatureOf,
  type MeasureReading,
} from './data-measures.ts';
import { eventTime, pointerIssues } from './data-pointers.ts';

export interface DataReading {
  readonly data: DataPart;
  readonly expressions: readonly DataExpression[];
}

const projectionKeys = ['events', 'time', 'series', 'target'] as const;

const sha256Pattern = /^[0-9a-f]{64}$/u;

function presentOf<A>(readings: readonly MeasureReading<A>[]): readonly A[] {
  return readings.flatMap(({ value }) => (value === undefined ? [] : [value]));
}

function namesIssues(names: readonly string[], written: WrittenData, target: string, lines: SourceLines) {
  return [...featureNameIssues(names, target, lines), ...givenIssues(written.given ?? [], names, lines)];
}

function uploadedOf(written: WrittenData, dataset: string, target: string, lines: SourceLines): Checked<DataReading> {
  const projected = projectionKeys
    .filter((key) => written[key] !== undefined)
    .flatMap((key) =>
      refusedAt(
        lines,
        `/data/${key}`,
        `${key} describes a projection of the playbook's history, and a function that names an uploaded dataset has none`,
      ),
    );
  const digest = sha256Pattern.test(dataset)
    ? []
    : refusedAt(
        lines,
        '/data/dataset',
        'dataset is the SHA-256 of an uploaded dataset, 64 lowercase hexadecimal digits',
      );
  const named = (written.features ?? []).map((item, index) => namedFeatureOf(item, `/data/features/${index}`, lines));
  const features = presentOf(named);
  const issues = [
    ...projected,
    ...digest,
    ...named.flatMap(({ issues: of }) => of),
    ...namesIssues(features, written, target, lines),
  ];
  return checkedFrom(issues, () => ({
    data: { dataset, features, given: written.given ?? [], window: written.window },
    expressions: [],
  }));
}

interface Projection {
  readonly events: NonNullable<WrittenData['events']>;
  readonly time: string;
  readonly series: string;
  readonly target: NonNullable<WrittenData['target']>;
}

function projectionOf({ events, time, series, target }: WrittenData): Projection | undefined {
  return events === undefined || time === undefined || series === undefined || target === undefined
    ? undefined
    : { events, time, series, target };
}

function missingIssues(written: WrittenData, lines: SourceLines): readonly DocumentIssue[] {
  return projectionKeys
    .filter((key) => written[key] === undefined)
    .flatMap((key) => refusedAt(lines, '/data', `${key} is required, unless the function names an uploaded dataset`));
}

function projectionIssues(
  { time, series, target }: Projection,
  filters: readonly DatasetFilter[],
  lines: SourceLines,
): readonly DocumentIssue[] {
  return [
    ...(time === eventTime ? [] : pointerIssues(time, '/data/time', filters, lines)),
    ...pointerIssues(series, '/data/series', filters, lines),
    ...measureIssues(target, '/data/target', filters, lines),
  ];
}

function readFrom(
  projection: Projection,
  written: WrittenData,
  named: string,
  lines: SourceLines,
): Checked<DataReading> {
  const read = filtersOf(projection.events, lines);
  if (Result.isFailure(read)) {
    return Result.fail(read.failure);
  }
  const filters = read.success;
  const readings = featuresOf(written.features ?? [], filters, lines);
  const features: readonly Feature[] = presentOf(readings);
  const issues = [
    ...projectionIssues(projection, filters, lines),
    ...readings.flatMap(({ issues: of }) => of),
    ...namesIssues(
      features.map(({ name }) => name),
      written,
      named,
      lines,
    ),
  ];
  const { time, series, target } = projection;
  return checkedFrom(issues, () => ({
    data: { events: filters, time, series, target, features, given: written.given ?? [], window: written.window },
    expressions: expressionsOf(filters, lines),
  }));
}

function projectedOf(written: WrittenData, target: string, lines: SourceLines): Checked<DataReading> {
  const projection = projectionOf(written);
  return projection === undefined
    ? Result.fail(missingIssues(written, lines))
    : readFrom(projection, written, target, lines);
}

export function dataOf(written: WrittenData, target: string, lines: SourceLines): Checked<DataReading> {
  return written.dataset === undefined
    ? projectedOf(written, target, lines)
    : uploadedOf(written, written.dataset, target, lines);
}
