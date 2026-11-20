import { playbookRowsOf, streamPrefixOfAddress, type PlaybookProjectedRow } from '@on.auto/operations';
import type { DueItem, DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import type { Instant } from '../goal-rules/goal-rule.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clocksName } from '../goal-tables/clock-rows.ts';
import type { ClockPorts } from './clock-judging.ts';
import { clockRowPerformed } from './clock-row-work.ts';
import { judgingRowPerformed } from './judging-row-work.ts';

export const goalsClockName = 'the clock of the goals';

interface DueTable {
  readonly name: string;
  readonly column: string;
  readonly performed: (ports: ClockPorts, kept: PlaybookProjectedRow, now: Instant) => Effect.Effect<void, unknown>;
}

const dueTables: readonly DueTable[] = [
  { name: clocksName, column: 'opens_at', performed: clockRowPerformed },
  { name: assessmentsName, column: 'judging_due_at', performed: judgingRowPerformed },
];

function itemOf(ports: ClockPorts, table: DueTable, kept: PlaybookProjectedRow): DueItem {
  return {
    key: `${streamPrefixOfAddress(kept)}${table.name}/${kept.key}`,
    callsOut: false,
    perform: (now) => Effect.suspend(() => table.performed(ports, kept, now)),
  };
}

function dueItemsAt(ports: ClockPorts, now: Instant, most: number): Effect.Effect<readonly DueItem[]> {
  const none: readonly DueItem[] = [];
  return Effect.reduce(
    dueTables,
    () => none,
    (items, table) =>
      items.length >= most
        ? Effect.succeed(items)
        : Effect.map(
            ports.ledger.readDueRows(table.name, { column: table.column, through: now, limit: most - items.length }),
            (rows) => [...items, ...playbookRowsOf(table.name, rows).map((kept) => itemOf(ports, table, kept))],
          ),
  );
}

function soonestDueAfter(ports: ClockPorts, after: Instant): Effect.Effect<Instant | null> {
  return Effect.map(
    Effect.forEach(dueTables, ({ name, column }) => ports.ledger.nextDueOf(name, column, after)),
    (times: readonly (Instant | null)[]) => {
      const set = times.filter((time) => time !== null);
      return set.length === 0 ? null : Math.min(...set);
    },
  );
}

export function goalsClockOf(ports: ClockPorts): DueWork {
  return {
    name: goalsClockName,
    due: (now, most, callsOut) => (callsOut ? Effect.succeed([]) : dueItemsAt(ports, now, most)),
    nextDueAt: (after, callsOut) => (callsOut === true ? Effect.succeed(null) : soonestDueAfter(ports, after)),
  };
}
