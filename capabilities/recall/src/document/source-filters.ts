import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { literalFilterOf, type LiteralFilterReading } from '@on.auto/workflow-engine/dsl';
import type { ViewFilter } from '@on.auto/workflow-host';
import { Predicate, Result, type Schema } from 'effect';

import { recallBounds } from '../run/recall-bounds.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

interface ReadFilter {
  readonly filter: ViewFilter;
}

interface RefusedFilter {
  readonly issues: readonly DocumentIssue[];
}

type FilterReading = ReadFilter | RefusedFilter;

type Rejection = Extract<LiteralFilterReading, { readonly rejections: unknown }>['rejections'][number];

const events = '/source/events';

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

function filterOf(filter: Schema.Json, index: number, lines: SourceLines): FilterReading {
  const pointer = `${events}/${index}`;
  if (!isAttributes(filter)) {
    return { issues: [issueAt(lines, pointer, notAMapping)] };
  }
  const reading = literalFilterOf({ with: filter }, pointer);
  return 'rejections' in reading
    ? { issues: rejectionIssues(reading.rejections, pointer, lines) }
    : { filter: { ...reading.filter.attributes, type: reading.filter.type } };
}

function isRefused(reading: FilterReading): reading is RefusedFilter {
  return 'issues' in reading;
}

function isRead(reading: FilterReading): reading is ReadFilter {
  return 'filter' in reading;
}

function countIssues(filters: readonly Schema.Json[], lines: SourceLines): readonly DocumentIssue[] {
  if (filters.length === 0) {
    return [issueAt(lines, events, 'A recall function folds the events at least one filter names; it names none')];
  }
  return filters.length > recallBounds.mostFilters
    ? [
        issueAt(
          lines,
          events,
          `A recall function takes at most ${recallBounds.mostFilters} filters; it names ${filters.length}`,
        ),
      ]
    : [];
}

export function filtersOf(filters: readonly Schema.Json[], lines: SourceLines): Checked<readonly ViewFilter[]> {
  const readings = filters.map((filter, index) => filterOf(filter, index, lines));
  const issues = [
    ...countIssues(filters, lines),
    ...readings.filter((reading) => isRefused(reading)).flatMap((refused) => refused.issues),
  ];
  return issues.length > 0
    ? Result.fail(issues)
    : Result.succeed(readings.filter((reading) => isRead(reading)).map((read) => read.filter));
}
