import { playbookGoalsIn, type Goal } from '@on.auto/definitions/goals';
import {
  playbookLedgerOf,
  streamPrefixOfPlaybook,
  type PlaybookAddress,
  type ProjectedKeyedRow,
  type RecordedEvent,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { failedRunOf } from '../assessor/run-observations.ts';
import { stoppedDeliveryOf } from '../assessor/stopped-deliveries.ts';
import { openItemsOf, stopWalksOf, stopsOf, type StopParts, type StopWalks } from '../assessor/stopped-runs.ts';
import { chainOriginsOf } from '../chain-origins/chain-origins.ts';
import { actsOf } from '../chain-origins/outside-events.ts';
import { heldAssessmentsOf } from '../reads/assessment-read.ts';

const mostFailedRunsCaughtUp = 200;

const endedBadly = ['run_failed', 'run_rejected'];

export interface CatchUpParts<E> extends StopParts<E> {
  readonly now: () => number;
}

function oldestUnstoppedActOf(parts: CatchUpParts<unknown>, playbook: PlaybookAddress, goals: readonly Goal[]) {
  return Effect.map(
    Effect.forEach(goals, (goal) => openItemsOf(parts.ledger, playbook, goal)),
    (found: readonly (readonly ProjectedKeyedRow[])[]) => {
      const acts = found
        .flat()
        .filter(({ row }) => row['stopped_at'] === null)
        .flatMap((kept) => heldAssessmentsOf(kept))
        .flatMap(({ state }) => actsOf(state).map(({ at }) => at));
      return acts.length === 0 ? undefined : Math.min(...acts);
    },
  );
}

function failedRunsSince(parts: CatchUpParts<unknown>, playbook: PlaybookAddress, oldest: number) {
  return Effect.map(
    parts.ledger.readRecorded(
      playbook,
      { kind: 'runs', definitionType: 'workflow' },
      { order: 'desc', limit: mostFailedRunsCaughtUp, types: endedBadly },
    ),
    ({ records }) => records.filter(({ context }) => Date.parse(context.at) >= oldest),
  );
}

function stoppedBy<E>(parts: CatchUpParts<E>, playbook: PlaybookAddress, record: RecordedEvent, walks: StopWalks<E>) {
  const failed = failedRunOf(record);
  if (failed === undefined) {
    return Effect.void;
  }
  const delivery = { ledger: parts.ledger, playbook, workflow: failed.name, now: parts.now };
  return Effect.flatMap(
    stopsOf(parts, { playbook, playbookKey: streamPrefixOfPlaybook(playbook), record }, failed, walks),
    (stopped) => Effect.forEach(stopped, (planned) => stoppedDeliveryOf(delivery, planned).deliver, { discard: true }),
  );
}

export function caughtUp<E>(parts: CatchUpParts<E>, playbook: PlaybookAddress) {
  return Effect.gen(function* () {
    const standing = yield* Effect.provideContext(playbookGoalsIn, playbookLedgerOf(parts.ledger, playbook));
    const goals = standing.goals.filter(({ retired }) => retired !== true);
    const oldest = yield* oldestUnstoppedActOf(parts, playbook, goals);
    if (oldest === undefined) {
      return;
    }
    const failed = yield* failedRunsSince(parts, playbook, oldest);
    const walks = stopWalksOf(chainOriginsOf(parts.chainsOf(playbook), parts.callers), true);
    for (const record of failed) {
      yield* stoppedBy(parts, playbook, record, walks);
    }
  });
}
