import { goalStandingIn } from '@on.auto/definitions/goals';
import {
  PlaybookContext,
  playbookLedgerOf,
  type PlaybookAddress,
  type PlaybookProjectedRow,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { clockWorkAt, type ClockWork } from '../goal-clock/goal-clock.ts';
import type { GoalRule, Instant } from '../goal-rules/goal-rule.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clocksName, goalClocksIn, type GoalClockEntry } from '../goal-tables/clock-rows.ts';
import { utcMidnightAfter } from '../goal-windows/goal-durations.ts';
import { judgedAt, openedAt, playbookRetiredIn, type Acting, type ClockPorts } from './clock-judging.ts';
import { retiredDayHeld } from './retired-day.ts';

export const mostEndedInARead = 64;

type GoalStanding = Effect.Success<typeof goalStandingIn>;

function isReporting({ workflows }: GoalStanding, goal: string): boolean {
  return workflows.some(
    ({ paused, contributes }) =>
      !paused && contributes.some((entry) => entry.goal === goal && entry.measures !== undefined),
  );
}

function workOf(
  standing: GoalStanding,
  clock: GoalClockEntry,
  at: Readonly<{ now: Instant; retired: boolean }>,
): ClockWork {
  const goal: GoalRule | undefined = standing.goals.find(({ id }) => id === clock.id);
  return clockWorkAt({
    goal,
    goalsVersion: standing.version,
    now: at.now,
    reporting: isReporting(standing, clock.id),
    playbookRetired: at.retired,
    firstSavedAt: clock.first_saved_at,
    ...(clock.latest_opened === undefined ? {} : { latestOpened: clock.latest_opened }),
    ...(standing.armedAt === undefined ? {} : { armedAt: standing.armedAt }),
  });
}

interface OpenRowsAsked {
  readonly goal: GoalRule;
  readonly after?: string;
  readonly limit: number;
}

function openRowsOf(ports: ClockPorts, acting: Acting, { goal, after, limit }: OpenRowsAsked) {
  return ports.ledger.readProjectedRows(assessmentsName, acting.address, {
    where: [
      { column: 'goal', equals: goal.id },
      { column: 'open', equals: true },
    ],
    orderBy: [],
    order: 'asc',
    ...(after === undefined ? {} : { after: [after] }),
    limit,
  });
}

function endedOfRetiredGoal(
  ports: ClockPorts,
  acting: Acting,
  asked: Omit<OpenRowsAsked, 'limit'>,
): Effect.Effect<void, unknown> {
  const { goal } = asked;
  return Effect.flatMap(openRowsOf(ports, acting, { ...asked, limit: mostEndedInARead }), (rows) =>
    Effect.andThen(
      Effect.forEach(
        rows,
        ({ key }) => judgedAt(ports, acting, key, { goal, now: acting.now, playbookRetired: false }),
        { discard: true },
      ),
      Effect.forEach(rows.length < mostEndedInARead ? [] : rows.slice(-1), ({ key }) =>
        endedOfRetiredGoal(ports, acting, { goal, after: key }),
      ),
    ),
  );
}

function isLeftOpenBy(ports: ClockPorts, acting: Acting, goal: GoalRule): Effect.Effect<boolean> {
  return Effect.map(openRowsOf(ports, acting, { goal, limit: 1 }), (rows) => rows.length > 0);
}

function leftOpenBy(ports: ClockPorts, acting: Acting, goals: readonly GoalRule[]): Effect.Effect<boolean> {
  return Effect.map(
    Effect.forEach(goals, (goal) => isLeftOpenBy(ports, acting, goal)),
    (open: readonly boolean[]) => open.includes(true),
  );
}

function earliestOf(works: readonly ClockWork[]): Instant | null {
  const times = works.flatMap(({ nextAt }) => (nextAt === null ? [] : [nextAt]));
  return times.length === 0 ? null : Math.min(...times);
}

function versionHeldBy(row: PlaybookProjectedRow['row']) {
  return [{ column: 'goals_version', equals: Number(row['goals_version']) }];
}

export function clockRowPerformed(ports: ClockPorts, kept: PlaybookProjectedRow, now: Instant) {
  return Effect.gen(function* () {
    const address: PlaybookAddress = { org: kept.org, playbook: kept.playbook };
    const acting: Acting = { address, now };
    const retired = yield* playbookRetiredIn(ports, address);
    const standing = yield* Effect.provideContext(
      Effect.provideService(goalStandingIn, PlaybookContext, address),
      playbookLedgerOf(ports.ledger, address),
    );
    const retiredGoals = standing.goals.filter((goal) => goal.retired === true);
    const waiting = retired ? yield* leftOpenBy(ports, acting, retiredGoals) : false;
    yield* retired
      ? retiredDayHeld(ports, address, now)
      : Effect.forEach(retiredGoals, (goal) => endedOfRetiredGoal(ports, acting, { goal }), { discard: true });
    const works = goalClocksIn(kept.row).map((clock) => workOf(standing, clock, { now, retired }));
    yield* Effect.forEach(
      works.flatMap(({ open }) => (open === undefined ? [] : [open])),
      ({ assessment, opened }) => openedAt(ports, acting, assessment, opened),
      { discard: true },
    );
    yield* ports.ledger.advanceRow(clocksName, address, kept.key, {
      set: { opens_at: earliestOf([...works, ...(waiting ? [{ nextAt: utcMidnightAfter(now) }] : [])]) },
      when: versionHeldBy(kept.row),
    });
  });
}
