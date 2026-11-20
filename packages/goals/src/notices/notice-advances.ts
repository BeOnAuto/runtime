import {
  addressOfTheRow,
  type PlaybookAddress,
  type PlaybookProjectedRow,
  type ProjectedCondition,
  type ProjectedRow,
} from '@on.auto/operations';
import { Effect } from 'effect';

import type { NoticeChange } from '../assessments/assessment-identity.ts';
import { unopened, type AssessmentState } from '../assessments/assessment-state.ts';
import { retiredWakeIn } from '../clock/retired-day.ts';
import { assessmentStateOfText } from '../goal-tables/assessment-row-state.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { utcMidnightAtOrAfter } from '../goal-windows/goal-durations.ts';
import type { NoticePorts } from './notice-ledger.ts';

export const noticeDueColumn = 'notice_due_at';

export type Moment = number | null;

export function rowStateOf(row: ProjectedRow): AssessmentState {
  return assessmentStateOfText(row['state']) ?? unopened;
}

function earliestOf(moments: readonly Moment[]): number | null {
  const kept = moments.filter((moment) => moment !== null);
  return kept.length === 0 ? null : Math.min(...kept);
}

type Waits = ReadonlyMap<NoticeChange, Moment>;

interface Held {
  readonly now: number;
  readonly least?: number;
  readonly retired?: true;
}

function nextDueAfter(state: AssessmentState, waits: Waits, now: number): number | null {
  return earliestOf(
    state.owed.map(({ change, due }) => {
      const wait = due <= now ? waits.get(change) : undefined;
      return wait === undefined ? due : wait;
    }),
  );
}

function unchangedSince(state: unknown): readonly ProjectedCondition[] {
  return typeof state === 'string' ? [{ column: 'state', equals: state }] : [];
}

function heldPast(next: number | null, { least, retired }: Required<Pick<Held, 'least'>> & Held): number | null {
  if (next === null) {
    return null;
  }
  return retired === true ? utcMidnightAtOrAfter(Math.max(next, least)) : Math.max(next, least);
}

export function advancedPast(ports: NoticePorts, owing: PlaybookProjectedRow, waits: Waits, at: Held) {
  const { now, least = now } = at;
  const holding = { ...at, least };
  const { key } = owing;
  const address = addressOfTheRow(owing);
  return Effect.flatMap(
    ports.ledger.readProjectedRows(assessmentsName, address, {
      where: [{ column: 'row_key', equals: key }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    ([fresh = owing]) =>
      ports.ledger.advanceRow(assessmentsName, address, key, {
        set: {
          [noticeDueColumn]: heldPast(nextDueAfter(rowStateOf(fresh.row), waits, now), holding),
        },
        when: [{ column: noticeDueColumn, before: now + 1 }, ...unchangedSince(fresh.row['state'])],
      }),
  );
}

export function retiredHeld(ports: NoticePorts, owing: PlaybookProjectedRow, now: number) {
  const address: PlaybookAddress = { org: owing.org, playbook: owing.playbook };
  return Effect.flatMap(retiredWakeIn(ports.ledger, address, now), (least) =>
    advancedPast(ports, owing, new Map(), { now, least, retired: true }),
  );
}
