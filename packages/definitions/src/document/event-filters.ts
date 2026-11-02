import { articled, capitalized } from '@on.auto/phrasing';
import { enclosedBody, literalFilterOf, type LiteralFilterReading } from '@on.auto/workflow-engine/dsl';
import { Predicate, Result, type Schema } from 'effect';

import { issueAt, type DocumentIssue, type SourceLines } from './document-issue.ts';

export interface EventFilter {
  readonly type: string;
  readonly [attribute: string]: Schema.Json;
}

export interface FilterExpression {
  readonly source: string;
  readonly pointer: string;
  readonly line: number;
}

export interface FiltersPlace {
  readonly pointer: string;
  readonly noun: string;
  readonly most: number;
}

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

type FilterReading = { readonly filter: EventFilter } | { readonly issues: readonly DocumentIssue[] };

type Rejection = Extract<LiteralFilterReading, { readonly rejections: unknown }>['rejections'][number];

const notAMapping =
  'A filter is a mapping of the attributes an event must have: type, and optionally any other attribute of the event and its data';

function isAttributes(filter: Schema.Json): filter is Schema.JsonObject {
  return Predicate.isObject(filter) && !Array.isArray(filter);
}

function rejectionIssues(
  rejections: readonly Rejection[],
  pointer: string,
  lines: SourceLines,
): readonly DocumentIssue[] {
  return rejections.map(({ pointer: at, detail }) => issueAt(lines, at.replace(`${pointer}/with`, pointer), detail));
}

function filterOf(filter: Schema.Json, pointer: string, lines: SourceLines): FilterReading {
  if (!isAttributes(filter)) {
    return { issues: [issueAt(lines, pointer, notAMapping)] };
  }
  const reading = literalFilterOf({ with: filter }, pointer);
  return 'rejections' in reading
    ? { issues: rejectionIssues(reading.rejections, pointer, lines) }
    : { filter: { ...reading.filter.attributes, type: reading.filter.type } };
}

function countIssues(filters: readonly Schema.Json[], place: FiltersPlace, lines: SourceLines) {
  const named = capitalized(articled(place.noun));
  if (filters.length === 0) {
    return [issueAt(lines, place.pointer, `${named} folds the events at least one filter names; it names none`)];
  }
  return filters.length > place.most
    ? [issueAt(lines, place.pointer, `${named} takes at most ${place.most} filters; it names ${filters.length}`)]
    : [];
}

export function eventFiltersOf(
  filters: readonly Schema.Json[],
  place: FiltersPlace,
  lines: SourceLines,
): Checked<readonly EventFilter[]> {
  const readings = filters.map((filter, index) => filterOf(filter, `${place.pointer}/${index}`, lines));
  const issues = [
    ...countIssues(filters, place, lines),
    ...readings.flatMap((reading) => ('issues' in reading ? reading.issues : [])),
  ];
  const read = readings.flatMap((reading) => ('filter' in reading ? [reading.filter] : []));
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(read);
}

export function filterExpressionsOf(
  filters: readonly EventFilter[],
  pointer: string,
  lines: SourceLines,
): readonly FilterExpression[] {
  return filters.flatMap((filter, index) => {
    const source = enclosedBody(filter['data']);
    const at = `${pointer}/${index}/data`;
    return source === undefined ? [] : [{ source, pointer: at, line: issueAt(lines, at, '').line }];
  });
}
