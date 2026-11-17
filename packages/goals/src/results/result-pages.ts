import type { ProjectedCondition } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { closedReadsOf, heldAssessmentsOf, instantIn, type ClosedRead } from '../reads/assessment-read.ts';
import type { GoalRows, Rows } from './goal-rows.ts';

export const mostOnAResultsPage = 10;

const cursorPattern = /^\d{1,16}:.{1,200}$/su;

export const ResultsCursorSchema = Schema.String.check(Schema.isPattern(cursorPattern)).annotate({
  description: 'The next_cursor of the page before, to read on after it',
});

export const EndedOutcomeSchema = Schema.Literals(['passed', 'failed', 'no_result']).annotate({
  description: 'Only the results that ended this way: passed, failed or no_result',
});

export type EndedOutcome = typeof EndedOutcomeSchema.Type;

export function endedThat(outcome: EndedOutcome | undefined): ProjectedCondition {
  return outcome === undefined ? { column: 'open', equals: false } : { column: 'outcome', equals: outcome };
}

interface Position {
  readonly at: number;
  readonly key: string;
}

function positionIn(cursor: string | undefined): Position | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  const separator = cursor.indexOf(':');
  return { at: Number(cursor.slice(0, separator)), key: cursor.slice(separator + 1) };
}

function cursorOf({ at, key }: Position): string {
  return `${String(at)}:${key}`;
}

function positionOfRow(row: Rows[number]): Position {
  return { at: instantIn(row, 'closed_at', 0), key: row.key };
}

interface Page {
  readonly items: readonly ClosedRead[];
  readonly next: Position | undefined;
}

const readAtOnce = mostOnAResultsPage + 1;

interface Taken {
  readonly row: Rows[number];
  readonly items: readonly ClosedRead[];
}

function judgedIn(row: Rows[number]): readonly ClosedRead[] {
  return heldAssessmentsOf(row).flatMap((held) => closedReadsOf(held, instantIn(row, 'closed_at', 0)));
}

function pageFrom(
  rows: GoalRows,
  where: readonly ProjectedCondition[],
  from: Position | undefined,
  kept: readonly ClosedRead[],
): Effect.Effect<Page> {
  const after = from === undefined ? undefined : [from.at, from.key];
  return Effect.flatMap(rows.readAfter(where, ['closed_at'], 'desc', { limit: readAtOnce, after }), (found: Rows) => {
    const taken: readonly Taken[] = found.map((row, index) => ({
      row,
      items: [...kept, ...found.slice(0, index + 1).flatMap((each) => judgedIn(each))],
    }));
    const full = taken.find((each) => each.items.length >= mostOnAResultsPage);
    if (full !== undefined) {
      const more = full.row !== found.at(-1) || found.length === readAtOnce;
      return Effect.succeed({
        items: full.items.slice(0, mostOnAResultsPage),
        next: more ? positionOfRow(full.row) : undefined,
      });
    }
    const last = taken.at(-1);
    return last === undefined || found.length < readAtOnce
      ? Effect.succeed({ items: last?.items ?? kept, next: undefined })
      : pageFrom(rows, where, positionOfRow(last.row), last.items);
  });
}

export interface ResultsPage {
  readonly items: readonly ClosedRead[];
  readonly next_cursor: string | null;
}

export function resultsPageOf(
  rows: GoalRows,
  where: readonly ProjectedCondition[],
  cursor: string | undefined,
): Effect.Effect<ResultsPage> {
  return Effect.map(pageFrom(rows, where, positionIn(cursor), []), ({ items, next }) => ({
    items,
    next_cursor: next === undefined ? null : cursorOf(next),
  }));
}
