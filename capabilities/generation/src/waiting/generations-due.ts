import { playbookRowsOf, type PlaybookProjectedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import { polled } from './video-polls.ts';
import { timedOut } from './waiting-ends.ts';
import { settled, waitingIn, type WaitingParts, type WaitingPlace } from './waiting-parts.ts';
import { generationsWaitingName, waitingRowFrom, type WaitingRow } from './waiting-rows.ts';

interface GenerationsDueItem {
  readonly key: string;
  readonly callsOut: boolean;
  readonly perform: (now: number) => Effect.Effect<void>;
}

export interface GenerationsDue {
  readonly name: string;
  readonly due: (now: number, most: number, callsOut: boolean) => Effect.Effect<readonly GenerationsDueItem[]>;
  readonly nextDueAt: (after: number, callsOut?: boolean) => Effect.Effect<number | null>;
}

function rowNowOf(parts: WaitingParts, { playbook, key }: WaitingPlace): Effect.Effect<WaitingRow> {
  return Effect.map(
    parts.ledger.readProjectedRows(generationsWaitingName, playbook, {
      where: [{ column: 'row_key', equals: key }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    ([found]) => waitingRowFrom(found?.row),
  );
}

function isEndingDue({ ending_due_at: endingDueAt }: WaitingRow, now: number): boolean {
  return endingDueAt !== null && endingDueAt <= now;
}

function endedAtTheDeadline(parts: WaitingParts, place: WaitingPlace, now: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    const row = yield* rowNowOf(parts, place);
    const waiting = isEndingDue(row, now) ? yield* waitingIn(parts, place) : undefined;
    return waiting === undefined ? undefined : yield* settled(parts, waiting, timedOut(place, waiting));
  });
}

function itemOf(parts: WaitingParts, kept: PlaybookProjectedRow, callsOut: boolean): GenerationsDueItem {
  const place = {
    playbook: { org: kept.org, playbook: kept.playbook },
    key: kept.key,
    row: waitingRowFrom(kept.row),
  };
  return {
    key: `${kept.org}/${kept.playbook}/${kept.key}`,
    callsOut,
    perform: (now) =>
      Effect.suspend(() => (callsOut ? polled(parts, place, now) : endedAtTheDeadline(parts, place, now))),
  };
}

function dueColumnOf(callsOut: boolean): string {
  return callsOut ? 'poll_due_at' : 'ending_due_at';
}

function dueColumnsOf(callsOut: boolean | undefined): readonly string[] {
  return callsOut === undefined ? [dueColumnOf(true), dueColumnOf(false)] : [dueColumnOf(callsOut)];
}

function soonestOf(times: readonly (number | null)[]): number | null {
  const set = times.filter((time) => time !== null);
  return set.length === 0 ? null : Math.min(...set);
}

export function generationsDue(parts: WaitingParts): GenerationsDue {
  return {
    name: 'the generations the playbook waits for',
    due: (now, most, callsOut) =>
      Effect.map(
        parts.ledger.readDueRows(generationsWaitingName, { column: dueColumnOf(callsOut), through: now, limit: most }),
        (rows) => playbookRowsOf(generationsWaitingName, rows).map((kept) => itemOf(parts, kept, callsOut)),
      ),
    nextDueAt: (after, callsOut) =>
      Effect.map(
        Effect.forEach(dueColumnsOf(callsOut), (column) =>
          parts.ledger.nextDueOf(generationsWaitingName, column, after),
        ),
        soonestOf,
      ),
  };
}
