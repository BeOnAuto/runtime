import { heldGoalOfIdentity, playbookGoalsIn } from '@on.auto/definitions/goals';
import {
  addressOfTheRow,
  playbookLedgerOf,
  type PlaybookAddress,
  type PlaybookProjectedRow,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { judgingDueOf } from '../assessments/assessment-dues.ts';
import type { Instant } from '../goal-rules/goal-rule.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { judgedAt, playbookRetiredIn, type ClockPorts } from './clock-judging.ts';
import { retiredDayHeld } from './retired-day.ts';

function laterThan(now: Instant, due: Instant | undefined): Instant | null {
  return due !== undefined && due > now ? due : null;
}

export function judgingRowPerformed(ports: ClockPorts, kept: PlaybookProjectedRow, now: Instant) {
  return Effect.gen(function* () {
    const address: PlaybookAddress = { org: kept.org, playbook: kept.playbook };
    const held = heldGoalOfIdentity(
      yield* Effect.provideContext(playbookGoalsIn, playbookLedgerOf(ports.ledger, address)),
      kept.definition,
    );
    if (held === undefined) {
      return;
    }
    const playbookRetired = yield* playbookRetiredIn(ports, address);
    const judged = { goal: { org: address.org, definition: held.definition }, assessment: kept.key };
    const state = yield* judgedAt(ports, { address, now }, judged, { goal: held.goal, now, playbookRetired });
    yield* ports.ledger.advanceRow(assessmentsName, addressOfTheRow(kept), kept.key, {
      set: { judging_due_at: laterThan(now, judgingDueOf(state)) },
      when: [{ column: 'judging_due_at', equals: Number(kept.row['judging_due_at']) }],
    });
    if (playbookRetired) {
      yield* retiredDayHeld(ports, address, now);
    }
  });
}
