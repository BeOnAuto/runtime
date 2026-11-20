import type { PlaybookAddress, ProjectedAddress } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { retiredWakeAt } from '../clock/retired-day.ts';
import type { Instant } from '../goal-rules/goal-rule.ts';
import { clockKey, clocksName, goalClockIn, type GoalClockEntry } from '../goal-tables/clock-rows.ts';
import { utcMidnightAtOrAfter } from '../goal-windows/goal-durations.ts';
import type { NoticePorts } from '../notices/notice-ledger.ts';
import { mostSeenWaitMs, seenWaitMs } from '../notices/notice-starts.ts';
import { windowEdgesAt, type WindowTiming } from '../windows/window-times.ts';
import { clockRowIn } from './summary-ledger.ts';

export const summaryDueColumn = 'summary_at';

export type Moment = number | null;

export interface SummaryTime {
  readonly due?: Instant;
  readonly next: Instant | null;
}

const noSummary: SummaryTime = { next: null };

export function summaryTimeOf(clock: GoalClockEntry, now: number): SummaryTime {
  const { summary } = clock;
  if (clock.retired === true || summary === undefined) {
    return noSummary;
  }
  const after = clock.last_summary ?? clock.first_saved_at;
  const timing: WindowTiming = {
    kind: 'cron',
    expression: summary.cron,
    ...(summary.time_zone === undefined ? {} : { time_zone: summary.time_zone }),
  };
  return Result.match(windowEdgesAt(timing, { anchor: clock.first_saved_at, due: after, now }), {
    onFailure: () => noSummary,
    onSuccess: ({ latest, next }) => (latest > after ? { due: latest, next } : { next }),
  });
}

export interface Summary {
  readonly address: PlaybookAddress;
  readonly goal: { readonly org: string; readonly definition: string };
  readonly clock: GoalClockEntry;
  readonly due: Instant;
  readonly now: number;
}

export interface Advancing {
  readonly wait?: Moment;
  readonly now: number;
  readonly retired?: boolean;
}

function nextOf(clock: GoalClockEntry, { wait, now, retired }: Advancing, least: number): number | null {
  if (wait !== undefined && wait !== null) {
    return wait;
  }
  const { next } = summaryTimeOf(clock, now);
  if (next === null) {
    return null;
  }
  return retired === true ? utcMidnightAtOrAfter(Math.max(next, least)) : Math.max(next, least);
}

export function advancedPast(ports: NoticePorts, at: ProjectedAddress, advancing: Advancing) {
  return Effect.flatMap(clockRowIn(ports.ledger, at), (fresh) => {
    const clock = goalClockIn(fresh);
    if (clock === undefined) {
      return Effect.void;
    }
    return ports.ledger.advanceRow(clocksName, at, clockKey, {
      set: {
        [summaryDueColumn]: nextOf(
          clock,
          advancing,
          advancing.retired === true ? retiredWakeAt(advancing.now, fresh) : advancing.now,
        ),
      },
      when: [
        { column: summaryDueColumn, before: advancing.now + 1 },
        { column: 'clock', equals: String(fresh?.['clock']) },
      ],
    });
  });
}

export function seenWaitOf({ due, now }: Summary): number {
  return Math.min(Math.max(seenWaitMs, now - due), mostSeenWaitMs);
}

export function earlierDueOf({ clock, due }: Summary): Instant | undefined {
  return summaryTimeOf(clock, due - 1).due;
}
