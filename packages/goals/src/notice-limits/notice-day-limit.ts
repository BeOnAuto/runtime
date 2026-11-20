import { mostGoals } from '@on.auto/definitions/goals';
import type { Ledger, PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { noticeDayOf, noticeDaysName } from '../goal-tables/notice-days.ts';

export const mostNoticesADay = 200;

export function noticesStartedOn(
  ledger: Ledger['Service'],
  address: PlaybookAddress,
  now: number,
): Effect.Effect<number, unknown> {
  return Effect.map(
    ledger.readProjectedRows(noticeDaysName, address, {
      where: [{ column: 'row_key', equals: noticeDayOf(now) }],
      orderBy: [],
      order: 'asc',
      limit: mostGoals,
    }),
    (days) => days.reduce((sum, { row }) => sum + Number(row['started']), 0),
  );
}

export interface StartsMade {
  readonly made: Map<string, ReadonlySet<string>>;
  readonly seenFirst: Map<string, number>;
}

export function noStartsMade(): StartsMade {
  return { made: new Map(), seenFirst: new Map() };
}

function dayKeyOf({ org, playbook }: PlaybookAddress, now: number): string {
  return `${org}/${playbook}/${noticeDayOf(now)}`;
}

function madeToday(starts: StartsMade, key: string, day: string): ReadonlySet<string> {
  for (const kept of [...starts.made.keys(), ...starts.seenFirst.keys()]) {
    if (!kept.endsWith(day)) {
      starts.made.delete(kept);
      starts.seenFirst.delete(kept);
    }
  }
  return starts.made.get(key) ?? new Set();
}

function startedToday(starts: StartsMade, key: string, seen: number, made: ReadonlySet<string>): number {
  const seenFirst = starts.seenFirst.get(key) ?? seen;
  starts.seenFirst.set(key, seenFirst);
  return Math.max(seen, seenFirst + made.size);
}

export interface DayStart {
  readonly address: PlaybookAddress;
  readonly run: string;
  readonly now: number;
}

export function startReservedUnderTheLimit(
  ledger: Ledger['Service'],
  starts: StartsMade,
  { address, run, now }: DayStart,
): Effect.Effect<boolean, unknown> {
  return Effect.map(noticesStartedOn(ledger, address, now), (seen) => {
    const key = dayKeyOf(address, now);
    const made = madeToday(starts, key, noticeDayOf(now));
    if (made.has(run)) {
      return true;
    }
    if (startedToday(starts, key, seen, made) >= mostNoticesADay) {
      return false;
    }
    starts.made.set(key, new Set([...made, run]));
    return true;
  });
}

export function startReleased(starts: StartsMade, { address, run, now }: DayStart): void {
  const key = dayKeyOf(address, now);
  const made = starts.made.get(key);
  if (made !== undefined) {
    starts.made.set(key, new Set([...made].filter((each) => each !== run)));
  }
}

const dayLimitWords = ` reached its limit of ${String(mostNoticesADay)} messages and summaries on `;

export function dayLimitDetail({ playbook }: PlaybookAddress, now: number): string {
  return `The playbook ${playbook}${dayLimitWords}${noticeDayOf(now)} (UTC)`;
}

export function isDayLimitDetail(detail: string): boolean {
  return detail.startsWith('The playbook ') && detail.includes(dayLimitWords);
}

export function lowered(detail: string): string {
  return `${detail.charAt(0).toLowerCase()}${detail.slice(1)}`;
}

export function withoutClosingPeriod(detail: string): string {
  return detail.replace(/\.+$/u, '');
}

export const sendingResumes = 'Nothing needs fixing: sending resumes on the next UTC day';
