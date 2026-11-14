import { playbookGoalsIn, type Goal } from '@on.auto/definitions/goals';
import {
  playbookLedgerOf,
  playbookRowsOf,
  type PlaybookAddress,
  type PlaybookProjectedRow,
  type RecordedCaller,
} from '@on.auto/operations';
import type { DueItem, DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { clocksName, goalClocksIn } from '../goal-tables/clock-rows.ts';
import type { StartsMade } from '../notice-limits/notice-day-limit.ts';
import { countedPortsOf, type CountedPorts, type NoticePorts } from '../notices/notice-ledger.ts';
import { summaryDue } from './summary-starts.ts';
import { advancedPast, summaryDueColumn, summaryTimeOf, type Moment, type Summary } from './summary-times.ts';

const summariesDueName = 'the summaries of goals due';

function goalsOf(ports: CountedPorts, address: PlaybookAddress): Effect.Effect<readonly Goal[]> {
  return Effect.map(
    Effect.provideContext(playbookGoalsIn, playbookLedgerOf(ports.ledger, address)),
    ({ goals }) => goals,
  );
}

function goalAnswered(
  ports: CountedPorts,
  summary: Summary,
  goals: readonly Goal[],
  owner: RecordedCaller | undefined,
): Effect.Effect<readonly [string, Moment], unknown> {
  const goal = goals.find(({ id, retired }) => id === summary.clock.id && retired !== true);
  const answered = goal === undefined ? Effect.succeed<Moment>(null) : summaryDue(ports, summary, goal, owner);
  return Effect.map(answered, (moment): readonly [string, Moment] => [summary.clock.id, moment]);
}

function summariesPerformed(ports: CountedPorts, { org, playbook, row }: PlaybookProjectedRow, now: number) {
  const address = { org, playbook };
  const due: readonly Summary[] = goalClocksIn(row).flatMap((clock): readonly Summary[] => {
    const time = summaryTimeOf(clock, now);
    return time.due === undefined ? [] : [{ address, clock, due: time.due, now }];
  });
  if (due.length === 0) {
    return advancedPast(ports, address, { waits: new Map(), now });
  }
  return Effect.flatMap(ports.playbookOf(address), ({ status, owner }) => {
    if (status !== 'active') {
      return advancedPast(ports, address, { waits: new Map(), now, retired: true });
    }
    return Effect.flatMap(goalsOf(ports, address), (goals) =>
      Effect.flatMap(
        Effect.forEach(due, (summary) => goalAnswered(ports, summary, goals, owner)),
        (answers: readonly (readonly [string, Moment])[]) =>
          advancedPast(ports, address, { waits: new Map(answers), now }),
      ),
    );
  });
}

function itemOf(ports: CountedPorts, due: PlaybookProjectedRow): DueItem {
  return {
    key: `${due.org}/${due.playbook}/goal-summaries`,
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
