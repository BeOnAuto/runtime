import { playbookGoalsIn, type HeldGoal } from '@on.auto/definitions/goals';
import {
  PlaybookReader,
  playbookLedgerOf,
  type Ledger,
  type PlaybookAddress,
  type ProjectedKeyedRow,
} from '@on.auto/operations';
import { Context, Effect } from 'effect';

import { originCounts } from '../chain-origins/chain-origin.ts';
import { chainOriginsOf, type ChainOrigins, type OutsideEvent } from '../chain-origins/chain-origins.ts';
import {
  actsOf,
  outsideEventsOf,
  sharesTheEvent,
  type ActOfARun,
  type OutsideEventOfARun,
} from '../chain-origins/outside-events.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { heldAssessmentsOf } from '../reads/assessment-read.ts';
import { byKey, type PlanParts, type PlannedRecord, type RunPlan, type StoppedPlanned } from './planned-runs.ts';
import { knownEntriesOf, type FailedRun } from './run-observations.ts';

export const mostOpenItemsSearched = 200;

export interface StopWalks<E> {
  readonly origins: ChainOrigins<E>;
  readonly began: OutsideEventOfARun<E>;
  readonly unstoppedOnly: boolean;
}

interface FailedInChain<E> {
  readonly failed: FailedRun;
  readonly endedAt: number;
  readonly chain: readonly string[];
  readonly outside: OutsideEvent | undefined;
  readonly walks: StopWalks<E>;
}

export function stopWalksOf<E>(origins: ChainOrigins<E>, unstoppedOnly = false): StopWalks<E> {
  return { origins, began: outsideEventsOf(origins), unstoppedOnly };
}

function reachedThing<E>(acts: readonly ActOfARun[], { endedAt, chain, outside, walks }: FailedInChain<E>) {
  if (acts.some(({ at }) => at > endedAt)) {
    return Effect.succeed(false);
  }
  return acts.some(({ run }) => chain.includes(run))
    ? Effect.succeed(true)
    : sharesTheEvent(walks.began, acts, outside);
}

function reachedBy<E>(definition: string, kept: ProjectedKeyedRow, failedInChain: FailedInChain<E>) {
  const { key, row } = kept;
  const { failed, endedAt, walks } = failedInChain;
  const held = walks.unstoppedOnly && row['stopped_at'] !== null ? [] : heldAssessmentsOf(kept);
  return Effect.map(
    Effect.forEach(held, ({ state }) => reachedThing(actsOf(state), failedInChain)),
    (reached: readonly boolean[]): readonly StoppedPlanned[] =>
      reached.includes(true)
        ? [
            {
              key: `s:${key}`,
              stopped: { definition, assessment: key, run: failed.run, at: endedAt, reason: failed.reason },
            },
          ]
        : [],
  );
}

export function openItemsOf(ledger: Ledger['Service'], { org }: PlaybookAddress, { definition }: HeldGoal) {
  return ledger.readProjectedRows(
    assessmentsName,
    { org, definition },
    {
      where: [{ column: 'open', equals: true }],
      orderBy: ['opened_at'],
      order: 'desc',
      limit: mostOpenItemsSearched,
    },
  );
}

function stoppedThingsOf<E>(
  ledger: Ledger['Service'],
  playbook: PlaybookAddress,
  goals: readonly HeldGoal[],
  failed: FailedInChain<E>,
): Effect.Effect<readonly StoppedPlanned[], E> {
  return Effect.gen(function* () {
    const reached = yield* Effect.forEach(goals, (goal) =>
      Effect.flatMap(openItemsOf(ledger, playbook, goal), (rows) =>
        Effect.forEach(rows, (row) => reachedBy(goal.definition, row, failed)),
      ),
    );
    return reached.flat(2);
  });
}

export type StopParts<E> = Pick<PlanParts<E>, 'ledger' | 'chainsOf' | 'callers' | 'versions'>;

const stoppedNothing: readonly StoppedPlanned[] = [];

export function stopsOf<E>(
  parts: StopParts<E>,
  { playbook, playbookKey, record }: PlannedRecord,
  failed: FailedRun,
  walks: StopWalks<E>,
) {
  return Effect.gen(function* () {
    const ledger = playbookLedgerOf(parts.ledger, playbook);
    const contributes = yield* parts.versions.contributesOf(Context.get(ledger, PlaybookReader), {
      playbookKey,
      ...failed,
    });
    if (contributes.length === 0) {
      return stoppedNothing;
    }
    const { stream, context, causationId, correlationId } = record;
    const { origin, runs, outside } = yield* walks.origins.chainOf({
      run: failed.run,
      fact: { stream, context, causationId, correlationId },
    });
    const standing = yield* Effect.provideContext(playbookGoalsIn, ledger);
    const goals = [...new Set(knownEntriesOf(contributes, standing.held).map(({ held }) => held))];
    if (!originCounts(origin) || goals.length === 0) {
      return stoppedNothing;
    }
    return yield* stoppedThingsOf(parts.ledger, playbook, goals, {
      failed,
      endedAt: Date.parse(context.at),
      chain: runs,
      outside,
      walks,
    });
  });
}

export function stoppingPlanOf<E>(
  parts: StopParts<E>,
  planned: PlannedRecord,
  failed: FailedRun,
): Effect.Effect<RunPlan, E> {
  const walks = stopWalksOf(chainOriginsOf(parts.chainsOf(planned.playbook), parts.callers));
  return Effect.map(stopsOf(parts, planned, failed, walks), byKey);
}
