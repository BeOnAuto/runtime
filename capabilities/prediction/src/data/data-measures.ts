import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';
import type { Schema } from 'effect';

import { figure } from '../capability/figures.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import { isMapping, nameIssues, refusedAt } from '../document/checked-parts.ts';
import { aggregations } from '../document/front-matter.ts';
import type { Aggregation, DatasetFilter, Feature, Measure } from '../document/prediction-document.ts';
import { pointerIssues } from './data-pointers.ts';

export interface MeasureReading<A> {
  readonly value?: A;
  readonly issues: readonly DocumentIssue[];
}

const featureKeys: ReadonlySet<string> = new Set(['name', 'of', 'as']);

function isAggregation(value: Schema.Json | undefined): value is Aggregation {
  return aggregations.some((aggregation) => aggregation === value);
}

export function measureIssues(
  { of, as }: Measure,
  at: string,
  filters: readonly DatasetFilter[],
  lines: SourceLines,
): readonly DocumentIssue[] {
  if (as === 'count') {
    return of === undefined
      ? []
      : refusedAt(lines, `${at}/of`, 'count counts the events and reads no value, so it takes no of');
  }
  return of === undefined
    ? refusedAt(lines, at, `${as} reads a value of each event, so it names where with of, a JSON Pointer into its data`)
    : pointerIssues(of, `${at}/of`, filters, lines);
}

function shapeIssues(item: Schema.JsonObject, at: string, lines: SourceLines): readonly DocumentIssue[] {
  const unknown = Object.keys(item)
    .filter((key) => !featureKeys.has(key))
    .flatMap((key) => refusedAt(lines, `${at}/${key}`, `${key} is not a key of a feature; it takes name, of and as`));
  const named = typeof item['name'] === 'string' ? [] : refusedAt(lines, `${at}/name`, 'name is required, as text');
  const read =
    item['of'] === undefined || typeof item['of'] === 'string' ? [] : refusedAt(lines, `${at}/of`, 'of is text');
  const aggregated = isAggregation(item['as'])
    ? []
    : refusedAt(lines, `${at}/as`, `as is required: ${aggregations.join(', ')}`);
  return [...unknown, ...named, ...read, ...aggregated];
}

function featureOf(
  item: Schema.Json,
  at: string,
  filters: readonly DatasetFilter[],
  lines: SourceLines,
): MeasureReading<Feature> {
  if (!isMapping(item)) {
    return { issues: refusedAt(lines, at, 'A feature is a mapping of its name, of and as') };
  }
  const shape = shapeIssues(item, at, lines);
  const { name, of, as } = item;
  if (shape.length > 0 || typeof name !== 'string' || !isAggregation(as)) {
    return { issues: shape };
  }
  const measure = typeof of === 'string' ? { of, as } : { as };
  return {
    value: { name, ...measure },
    issues: [...nameIssues(name, lines, `${at}/name`), ...measureIssues(measure, at, filters, lines)],
  };
}

export function namedFeatureOf(item: Schema.Json, at: string, lines: SourceLines): MeasureReading<string> {
  return typeof item === 'string'
    ? { value: item, issues: nameIssues(item, lines, at) }
    : { issues: refusedAt(lines, at, 'A feature of an uploaded dataset is the name of its column, as text') };
}

export function featuresOf(
  written: readonly Schema.Json[],
  filters: readonly DatasetFilter[],
  lines: SourceLines,
): readonly MeasureReading<Feature>[] {
  return written.map((item, index) => featureOf(item, `/data/features/${index}`, filters, lines));
}

export function featureNameIssues(
  names: readonly string[],
  target: string,
  lines: SourceLines,
): readonly DocumentIssue[] {
  const { mostFeatures } = predictionBounds;
  const counted =
    names.length > mostFeatures
      ? refusedAt(
          lines,
          '/data/features',
          `A prediction function takes at most ${mostFeatures} features; it names ${figure(names.length)}`,
        )
      : [];
  return [
    ...counted,
    ...names.flatMap((name, index) => {
      const at = `/data/features/${index}`;
      if (name === target) {
        return refusedAt(lines, at, `The feature ${name} is named as the target; the target is its own column`);
      }
      return names.indexOf(name) < index ? refusedAt(lines, at, `The feature ${name} is named more than once`) : [];
    }),
  ];
}

export function givenIssues(
  given: readonly string[],
  features: readonly string[],
  lines: SourceLines,
): readonly DocumentIssue[] {
  return given.flatMap((name, index) => {
    const at = `/data/given/${index}`;
    if (!features.includes(name)) {
      return refusedAt(lines, at, `${name} is not among the features, and given names only features`);
    }
    return given.indexOf(name) < index ? refusedAt(lines, at, `${name} is given more than once`) : [];
  });
}
