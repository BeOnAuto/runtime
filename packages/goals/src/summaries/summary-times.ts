import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { retiredWakeAt } from '../clock/retired-day.ts';
import type { Instant } from '../goal-rules/goal-rule.ts';
import { clockKey, clocksName, goalClocksIn, type GoalClockEntry } from '../goal-tables/clock-rows.ts';
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
  readonly clock: GoalClockEntry;
  readonly due: Instant;
  readonly now: number;
}

type Waits = ReadonlyMap<string, Moment>;

function earliestOf(moments: readonly (number | null)[]): number | null {
  const kept = moments.filter((moment) => moment !== null);
  return kept.length === 0 ? null : Math.min(...kept);
}

export interface Advancing {
  readonly waits: Waits;
  readonly now: number;
  readonly retired?: boolean;
}

function nextOf(clocks: readonly GoalClockEntry[], { waits, now, retired }: Advancing, least: number): number | null {
  return earliestOf(
    clocks.map((clock) => {
      const wait = waits.get(clock.id);
      if (wait !== undefined && wait !== null) {
        return wait;
      }
      const { next } = summaryTimeOf(clock, now);
      return next === null
        ? null
        : retired === true
          ? utcMidnightAtOrAfter(Math.max(next, least))
          : Math.max(next, least);
    }),
  );
}

export function advancedPast(ports: NoticePorts, address: PlaybookAddress, advancing: Advancing) {
  return Effect.flatMap(clockRowIn(ports.ledger, address), (fresh) => {
    const goals = fresh?.['goals'];
    if (typeof goals !== 'string') {
      return Effect.void;
    }
    return ports.ledger.advanceRow(clocksName, address, clockKey, {
      set: {
        [summaryDueColumn]: nextOf(
          goalClocksIn(fresh),
          advancing,
          advancing.retired === true ? retiredWakeAt(advancing.now, fresh) : advancing.now,
        ),
      },
      when: [
        { column: summaryDueColumn, before: advancing.now + 1 },
        { column: 'goals', equals: goals },
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
