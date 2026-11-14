import type { PlaybookAddress, ProjectedKeyedRow, ProjectedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Instant } from '../goal-rules/goal-rule.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clockKey, clocksName } from '../goal-tables/clock-rows.ts';
import { utcMidnightAfter } from '../goal-windows/goal-durations.ts';
import type { ClockPorts } from './clock-judging.ts';

export const mostHeldInARead = 64;

interface Holding {
  readonly address: PlaybookAddress;
  readonly now: Instant;
  readonly until: Instant;
}

function dueSoonAfter(ports: ClockPorts, { address, now, until }: Holding, after?: string) {
  return ports.ledger.readProjectedRows(assessmentsName, address, {
    where: [
      { column: 'judging_due_at', after: now },
      { column: 'judging_due_at', before: until },
    ],
    orderBy: [],
    order: 'asc',
    ...(after === undefined ? {} : { after: [after] }),
    limit: mostHeldInARead,
  });
}

function heldRow(ports: ClockPorts, { address, until }: Holding, { key, row }: ProjectedKeyedRow) {
  return ports.ledger.advanceRow(assessmentsName, address, key, {
    set: { judging_due_at: until },
    when: [{ column: 'judging_due_at', equals: Number(row['judging_due_at']) }],
  });
}

function assessmentsHeld(ports: ClockPorts, holding: Holding, after?: string): Effect.Effect<void> {
  return Effect.flatMap(dueSoonAfter(ports, holding, after), (rows) =>
    Effect.andThen(
      Effect.forEach(rows, (kept) => heldRow(ports, holding, kept), { discard: true }),
      Effect.forEach(rows.length < mostHeldInARead ? [] : rows.slice(-1), ({ key }) =>
        assessmentsHeld(ports, holding, key),
      ),
    ),
  );
}

export function retiredDayHeld(ports: ClockPorts, address: PlaybookAddress, now: Instant): Effect.Effect<void> {
  const holding: Holding = { address, now, until: utcMidnightAfter(now) };
  return Effect.andThen(
    assessmentsHeld(ports, holding),
    ports.ledger.advanceRow(clocksName, address, clockKey, {
      set: { opens_at: holding.until },
      when: [
        { column: 'opens_at', after: now },
        { column: 'opens_at', before: holding.until },
      ],
    }),
  );
}

export function retiredWakeIn(
  ledger: Pick<ClockPorts['ledger'], 'readProjectedRows'>,
  address: PlaybookAddress,
  now: Instant,
): Effect.Effect<Instant> {
  return Effect.map(
    ledger.readProjectedRows(clocksName, address, {
      where: [{ column: 'row_key', equals: clockKey }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    ([clock]) => retiredWakeAt(now, clock?.row),
  );
}

export function retiredWakeAt(now: Instant, clockRow?: ProjectedRow): Instant {
  const opens = Number(clockRow?.['opens_at']);
  const midnight = utcMidnightAfter(now);
  return opens > now && opens < midnight ? opens : midnight;
}
