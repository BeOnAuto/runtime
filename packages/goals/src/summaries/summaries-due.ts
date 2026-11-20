import { heldGoalOfIdentity, playbookGoalsIn } from '@on.auto/definitions/goals';
import {
  addressOfTheRow,
  playbookLedgerOf,
  playbookRowsOf,
  streamPrefixOfAddress,
  type PlaybookAddress,
  type PlaybookProjectedRow,
  type RecordedCaller,
} from '@on.auto/operations';
import type { DueItem, DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { clocksName, goalClockIn, type GoalClockEntry } from '../goal-tables/clock-rows.ts';
import type { StartsMade } from '../notice-limits/notice-day-limit.ts';
import { countedPortsOf, type CountedPorts, type NoticePorts } from '../notices/notice-ledger.ts';
import { summaryDue } from './summary-starts.ts';
import { advancedPast, summaryDueColumn, summaryTimeOf, type Moment } from './summary-times.ts';

const summariesDueName = 'the summaries of goals due';

interface SummaryOwed {
  readonly address: PlaybookAddress;
  readonly kept: PlaybookProjectedRow;
  readonly clock: GoalClockEntry;
  readonly due: number;
  readonly now: number;
}

function summaryAnswered(
  ports: CountedPorts,
  { address, kept, clock, due, now }: SummaryOwed,
  owner: RecordedCaller | undefined,
): Effect.Effect<void, unknown> {
  return Effect.flatMap(
    Effect.provideContext(playbookGoalsIn, playbookLedgerOf(ports.ledger, address)),
    (goals): Effect.Effect<void, unknown> => {
      const held = heldGoalOfIdentity(goals, kept.definition);
      if (held === undefined) {
        return Effect.void;
      }
      const goal = { org: address.org, definition: held.definition };
      const answered =
        held.goal.retired === true
          ? Effect.succeed<Moment>(null)
          : summaryDue(ports, { address, goal, clock, due, now }, held.goal, owner);
      return Effect.flatMap(answered, (wait) => advancedPast(ports, goal, { wait, now }));
    },
  );
}

function summariesPerformed(ports: CountedPorts, kept: PlaybookProjectedRow, now: number) {
  const { org, playbook } = kept;
  const address = { org, playbook };
  const goal = addressOfTheRow(kept);
  const clock = goalClockIn(kept.row);
  const due = clock === undefined ? undefined : summaryTimeOf(clock, now).due;
  if (clock === undefined || due === undefined) {
    return advancedPast(ports, goal, { now });
  }
  return Effect.flatMap(ports.playbookOf(address), ({ status, owner }) =>
    status === 'active'
      ? summaryAnswered(ports, { address, kept, clock, due, now }, owner)
      : advancedPast(ports, goal, { now, retired: true }),
  );
}

function itemOf(ports: CountedPorts, due: PlaybookProjectedRow): DueItem {
  return {
    key: `${streamPrefixOfAddress(due)}goal-summaries`,
    callsOut: false,
    perform: (now) => Effect.suspend(() => summariesPerformed(ports, due, now)),
  };
}

const nothingDue: readonly DueItem[] = [];

export function summariesDueOf(noticePorts: NoticePorts, starts?: StartsMade): DueWork {
  const ports = countedPortsOf(noticePorts, starts);
  return {
    name: summariesDueName,
    due: (now, most, callsOut) =>
      callsOut
        ? Effect.succeed(nothingDue)
        : Effect.map(
            ports.ledger.readDueRows(clocksName, { column: summaryDueColumn, through: now, limit: most }),
            (rows) => playbookRowsOf(clocksName, rows).map((due) => itemOf(ports, due)),
          ),
    nextDueAt: (after, callsOut = false) =>
      callsOut ? Effect.succeed(null) : ports.ledger.nextDueOf(clocksName, summaryDueColumn, after),
  };
}
