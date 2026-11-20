import { goalStandingIn, heldGoalOfIdentity, type HeldGoal } from '@on.auto/definitions/goals';
import {
  PlaybookContext,
  addressOfTheRow,
  playbookLedgerOf,
  type PlaybookAddress,
  type PlaybookProjectedRow,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { clockWorkAt, type ClockWork } from '../goal-clock/goal-clock.ts';
import type { Instant } from '../goal-rules/goal-rule.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clocksName, goalClockIn, type GoalClockEntry } from '../goal-tables/clock-rows.ts';
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

interface ClockOfAGoal {
  readonly held: HeldGoal;
  readonly clock: GoalClockEntry;
}

function workOf(
  standing: GoalStanding,
  { held, clock }: ClockOfAGoal,
  at: Readonly<{ now: Instant; retired: boolean }>,
): ClockWork {
  return clockWorkAt({
    definition: held.definition,
    goal: held.goal,
    goalVersion: held.version,
    now: at.now,
    reporting: isReporting(standing, held.goal.id),
    playbookRetired: at.retired,
    firstSavedAt: clock.first_saved_at,
    ...(clock.latest_opened === undefined ? {} : { latestOpened: clock.latest_opened }),
    ...(standing.armedAt === undefined ? {} : { armedAt: standing.armedAt }),
  });
}

interface OpenRowsAsked {
  readonly goal: { readonly org: string; readonly definition: string };
  readonly after?: string;
  readonly limit: number;
}

function openRowsOf(ports: ClockPorts, { goal, after, limit }: OpenRowsAsked) {
  return ports.ledger.readProjectedRows(assessmentsName, goal, {
    where: [{ column: 'open', equals: true }],
    orderBy: [],
    order: 'asc',
    ...(after === undefined ? {} : { after: [after] }),
    limit,
  });
}

function endedOfRetiredGoal(
  ports: ClockPorts,
  acting: Acting,
  held: HeldGoal,
  after?: string,
): Effect.Effect<void, unknown> {
  const goal = { org: acting.address.org, definition: held.definition };
  const asked = { goal, ...(after === undefined ? {} : { after }) };
  return Effect.flatMap(openRowsOf(ports, { ...asked, limit: mostEndedInARead }), (rows) =>
    Effect.andThen(
      Effect.forEach(
        rows,
        ({ key }) =>
          judgedAt(
            ports,
            acting,
            { goal, assessment: key },
            { goal: held.goal, now: acting.now, playbookRetired: false },
          ),
        { discard: true },
      ),
      Effect.forEach(rows.length < mostEndedInARead ? [] : rows.slice(-1), ({ key }) =>
        endedOfRetiredGoal(ports, acting, held, key),
      ),
    ),
  );
}

function isLeftOpenBy(ports: ClockPorts, acting: Acting, held: HeldGoal): Effect.Effect<boolean> {
  return held.goal.retired === true
    ? Effect.map(
        openRowsOf(ports, { goal: { org: acting.address.org, definition: held.definition }, limit: 1 }),
        (rows) => rows.length > 0,
      )
    : Effect.succeed(false);
}

function earliestOf(works: readonly Pick<ClockWork, 'nextAt'>[]): Instant | null {
  const times = works.flatMap(({ nextAt }) => (nextAt === null ? [] : [nextAt]));
  return times.length === 0 ? null : Math.min(...times);
}

function clockOfAGoalIn(standing: GoalStanding, kept: PlaybookProjectedRow): ClockOfAGoal | undefined {
  const held = heldGoalOfIdentity(standing, kept.definition);
  const clock = goalClockIn(kept.row);
  return held === undefined || clock === undefined ? undefined : { held, clock };
}

function nextOpeningAfter(ports: ClockPorts, acting: Acting, standing: GoalStanding, ofAGoal: ClockOfAGoal) {
  return Effect.gen(function* () {
    const { address, now } = acting;
    const retired = yield* playbookRetiredIn(ports, address);
    const waiting = retired ? yield* isLeftOpenBy(ports, acting, ofAGoal.held) : false;
    yield* retired
      ? retiredDayHeld(ports, address, now)
      : ofAGoal.held.goal.retired === true
        ? endedOfRetiredGoal(ports, acting, ofAGoal.held)
        : Effect.void;
    const work = workOf(standing, ofAGoal, { now, retired });
    if (work.open !== undefined) {
      const { assessment, opened } = work.open;
      yield* openedAt(
        ports,
        acting,
        { goal: { org: address.org, definition: ofAGoal.held.definition }, assessment },
        opened,
      );
    }
    return earliestOf([work, ...(waiting ? [{ nextAt: utcMidnightAfter(now) }] : [])]);
  });
}

export function clockRowPerformed(ports: ClockPorts, kept: PlaybookProjectedRow, now: Instant) {
  return Effect.gen(function* () {
    const address: PlaybookAddress = { org: kept.org, playbook: kept.playbook };
    const acting: Acting = { address, now };
    const standing = yield* Effect.provideContext(
      Effect.provideService(goalStandingIn, PlaybookContext, address),
      playbookLedgerOf(ports.ledger, address),
    );
    const ofAGoal = clockOfAGoalIn(standing, kept);
    if (ofAGoal === undefined) {
      return;
    }
    const opensAt = yield* nextOpeningAfter(ports, acting, standing, ofAGoal);
    yield* ports.ledger.advanceRow(clocksName, addressOfTheRow(kept), kept.key, {
      set: { opens_at: opensAt },
      when: [{ column: 'goal_version', equals: Number(kept.row['goal_version']) }],
    });
  });
}
