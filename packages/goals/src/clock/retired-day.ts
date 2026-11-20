import { mostGoals } from '@on.auto/definitions/goals';
import { addressOfTheRow, type PlaybookAddress, type ProjectedKeyedRow, type ProjectedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Instant } from '../goal-rules/goal-rule.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { clocksName } from '../goal-tables/clock-rows.ts';
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

function heldRow(ports: ClockPorts, { until }: Holding, kept: ProjectedKeyedRow) {
  return ports.ledger.advanceRow(assessmentsName, addressOfTheRow(kept), kept.key, {
    set: { judging_due_at: until },
    when: [{ column: 'judging_due_at', equals: Number(kept.row['judging_due_at']) }],
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

function clocksOf(ledger: Pick<ClockPorts['ledger'], 'readProjectedRows'>, address: PlaybookAddress) {
  return ledger.readProjectedRows(clocksName, address, { where: [], orderBy: [], order: 'asc', limit: mostGoals });
}

function clocksHeld(ports: ClockPorts, { address, now, until }: Holding): Effect.Effect<void> {
  return Effect.flatMap(clocksOf(ports.ledger, address), (clocks) =>
    Effect.forEach(
      clocks,
      (kept) =>
        ports.ledger.advanceRow(clocksName, addressOfTheRow(kept), kept.key, {
          set: { opens_at: until },
          when: [
            { column: 'opens_at', after: now },
            { column: 'opens_at', before: until },
          ],
        }),
      { discard: true },
    ),
  );
}

export function retiredDayHeld(ports: ClockPorts, address: PlaybookAddress, now: Instant): Effect.Effect<void> {
  const holding: Holding = { address, now, until: utcMidnightAfter(now) };
  return Effect.andThen(assessmentsHeld(ports, holding), clocksHeld(ports, holding));
}

export function retiredWakeIn(
  ledger: Pick<ClockPorts['ledger'], 'readProjectedRows'>,
  address: PlaybookAddress,
  now: Instant,
): Effect.Effect<Instant> {
  return Effect.map(clocksOf(ledger, address), (clocks) =>
    Math.min(retiredWakeAt(now), ...clocks.map(({ row }) => retiredWakeAt(now, row))),
  );
}

export function retiredWakeAt(now: Instant, clockRow?: ProjectedRow): Instant {
  const opens = Number(clockRow?.['opens_at']);
  const midnight = utcMidnightAfter(now);
  return opens > now && opens < midnight ? opens : midnight;
}
