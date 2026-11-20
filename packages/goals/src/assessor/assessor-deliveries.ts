import {
  playbookCallerOf,
  type Context,
  type Decider,
  type Ledger,
  type PlaybookAddress,
  type ProjectedRow,
} from '@on.auto/operations';
import { DeliveryFailed, type Delivery } from '@on.auto/workflow-host';
import { Cause, Effect, Result } from 'effect';

import { assessmentAfter, unopened, type AssessmentState } from '../assessments/assessment-state.ts';
import { factsObserving, type Observing } from '../assessments/observing.ts';
import {
  AssessmentEventSchema,
  GoalRefusalEventSchema,
  assessmentStreamOf,
  refusalsStreamOf,
  type GoalAddress,
  type RecordedAssessmentEvent,
  type RecordedGoalRefusalEvent,
} from '../goal-facts/goal-facts.ts';
import { observationsName, observedEntryKeyOf } from '../goal-tables/observation-rows.ts';
import { refusalsName, refusalStatus } from '../goal-tables/refusal-rows.ts';
import type { RefusedObservation } from '../observations/observation.ts';
import type { AssessmentPlanned, RefusalPlanned } from './planned-runs.ts';

export interface DeliveryParts {
  readonly ledger: Ledger['Service'];
  readonly playbook: PlaybookAddress;
  readonly workflow: string;
  readonly now: () => number;
}

export interface Acting {
  readonly by: string;
  readonly at: number;
  readonly definition: string;
}

export function goalContextOf({ by, at, definition }: Acting): Context {
  return { at: new Date(at).toISOString(), by, definitionId: definition };
}

function assessmentDecider(
  acting: Acting,
  decided: (appended: boolean) => void,
): Decider<AssessmentState, Observing, RecordedAssessmentEvent> {
  return {
    initialState: unopened,
    evolve: (state, fact) => assessmentAfter(state, fact),
    decide: (observing, state) => {
      const facts = factsObserving(state, observing);
      decided(facts.length > 0);
      return Result.succeed(facts);
    },
    context: () => goalContextOf(acting),
    eventSchema: AssessmentEventSchema,
  };
}

function refusalDecider(acting: Acting): Decider<null, RefusedObservation, RecordedGoalRefusalEvent> {
  return {
    initialState: null,
    evolve: () => null,
    decide: ({ run, detail }) => Result.succeed([{ type: 'goal_observation_refused', data: { run, detail } }]),
    context: () => goalContextOf(acting),
    eventSchema: GoalRefusalEventSchema,
  };
}

function failedDelivery(cause: Cause.Cause<unknown>): DeliveryFailed {
  return new DeliveryFailed({ detail: String(Cause.squash(cause)) });
}

function goalOf({ playbook }: DeliveryParts, definition: string): GoalAddress {
  return { org: playbook.org, definition };
}

function refusalRowOf(parts: DeliveryParts, goal: GoalAddress, workflow: string) {
  return Effect.map(
    parts.ledger.readProjectedRows(refusalsName, goal, {
      where: [{ column: 'row_key', equals: workflow }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    ([kept]) => kept?.row,
  );
}

function refusedAtOf(row: ProjectedRow | undefined): number | undefined {
  const at = row?.['at'];
  return typeof at === 'number' ? at : undefined;
}

function observedSinceIn(parts: DeliveryParts, goal: GoalAddress, observedKeys: readonly string[], at: unknown) {
  return Effect.map(
    Effect.forEach(observedKeys, (key) =>
      parts.ledger.countProjectedRows(observationsName, goal, [
        { column: 'row_key', equals: key },
        { column: 'observed_at', after: Number(at) },
      ]),
    ),
    (counts: readonly number[]) => counts.some((count) => count > 0),
  );
}

function clearingOf(parts: DeliveryParts, { held, observations }: AssessmentPlanned) {
  return Effect.gen(function* () {
    const goal = goalOf(parts, held.definition);
    const refusedAt = refusedAtOf(yield* refusalRowOf(parts, goal, parts.workflow));
    if (refusedAt === undefined) {
      return [];
    }
    const later = observations.filter(({ at }) => at > refusedAt);
    const clearing = yield* Effect.forEach(later, ({ source }) =>
      Effect.map(observedSinceIn(parts, goal, [observedEntryKeyOf(source)], refusedAt), (counted) =>
        counted ? [] : [source.record],
      ),
    );
    return clearing.flat();
  });
}

function executedWith(parts: DeliveryParts, planned: AssessmentPlanned, clearing: readonly string[]) {
  return Effect.suspend(() => {
    const { assessment, held, observations } = planned;
    const acting = { by: playbookCallerOf(parts.playbook).id, at: parts.now(), definition: held.definition };
    let appended = false;
    return Effect.map(
      parts.ledger.execute(
        assessmentStreamOf(goalOf(parts, held.definition), assessment),
        assessmentDecider(acting, (decided) => {
          appended = decided;
        }),
        { goal: held.goal, goalVersion: held.version, observations, now: acting.at, clearing },
      ),
      () => appended,
    );
  });
}

function observed(parts: DeliveryParts, planned: AssessmentPlanned) {
  return Effect.gen(function* () {
    if (yield* executedWith(parts, planned, [])) {
      return;
    }
    const clearing = yield* clearingOf(parts, planned);
    if (clearing.length > 0) {
      yield* executedWith(parts, planned, clearing);
    }
  });
}

function refused(parts: DeliveryParts, { definition, refused: refusal, endedAt, observedKeys }: RefusalPlanned) {
  return Effect.gen(function* () {
    const goal = goalOf(parts, definition);
    const acting = { by: playbookCallerOf(parts.playbook).id, at: endedAt, definition };
    const kept = yield* refusalRowOf(parts, goal, refusal.workflow);
    const status = refusalStatus(kept, refusal, endedAt);
    if (
      status === 'recorded' ||
      (status === 'standing' && !(yield* observedSinceIn(parts, goal, observedKeys, kept?.['at'])))
    ) {
      return;
    }
    yield* parts.ledger.execute(refusalsStreamOf(goal, refusal.workflow), refusalDecider(acting), refusal);
  });
}

export function deliveryOf(parts: DeliveryParts, planned: AssessmentPlanned | RefusalPlanned): Delivery {
  const work: Effect.Effect<unknown, unknown> =
    'refused' in planned ? refused(parts, planned) : observed(parts, planned);
  return deliveryDoing(planned.key, parts.workflow, work);
}

export function deliveryDoing(key: string, workflow: string, work: Effect.Effect<unknown, unknown>): Delivery {
  return {
    key,
    workflow,
    deliver: work.pipe(
      Effect.asVoid,
      Effect.catchCause((cause) => Effect.fail(failedDelivery(cause))),
    ),
    skipped: () => Effect.void,
  };
}

export function unreadDelivery(workflow: string, detail: string): Delivery {
  return {
    key: '!',
    workflow,
    deliver: Effect.fail(new DeliveryFailed({ detail })),
    skipped: () => Effect.void,
  };
}
