import {
  playbookCallerOf,
  streamPrefixOfPlaybook,
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
  assessmentsKind,
  goalRefusalsKind,
  type RecordedAssessmentEvent,
  type RecordedGoalRefusalEvent,
} from '../goal-facts/goal-facts.ts';
import { observationsName, observedEntryKeyOf } from '../goal-tables/observation-rows.ts';
import { refusalsName, refusalStatus } from '../goal-tables/refusal-rows.ts';
import type { RefusedObservation } from '../observations/observation.ts';
import { refusalStreamIdOf, type AssessmentPlanned, type Planned, type RefusalPlanned } from './planned-runs.ts';

interface DeliveryParts {
  readonly ledger: Ledger['Service'];
  readonly playbook: PlaybookAddress;
  readonly workflow: string;
  readonly now: () => number;
}

interface Acting {
  readonly by: string;
  readonly at: number;
}

function contextOf({ by, at }: Acting) {
  return { at: new Date(at).toISOString(), by };
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
    context: () => contextOf(acting),
    eventSchema: AssessmentEventSchema,
  };
}

function refusalDecider(acting: Acting): Decider<null, RefusedObservation, RecordedGoalRefusalEvent> {
  return {
    initialState: null,
    evolve: () => null,
    decide: ({ run, detail }) => Result.succeed([{ type: 'goal_observation_refused', data: { run, detail } }]),
    context: () => contextOf(acting),
    eventSchema: GoalRefusalEventSchema,
  };
}

function failedDelivery(cause: Cause.Cause<unknown>): DeliveryFailed {
  return new DeliveryFailed({ detail: String(Cause.squash(cause)) });
}

function actingNow({ playbook, now }: DeliveryParts): Acting {
  return { by: playbookCallerOf(playbook).id, at: now() };
}

function refusalRowOf(parts: DeliveryParts, refusal: Pick<RefusedObservation, 'goal' | 'workflow'>) {
  return Effect.map(
    parts.ledger.readProjectedRows(refusalsName, parts.playbook, {
      where: [{ column: 'row_key', equals: refusalStreamIdOf(refusal) }],
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

function clearingOf(parts: DeliveryParts, { goal, observations }: AssessmentPlanned) {
  return Effect.gen(function* () {
    const refusedAt = refusedAtOf(yield* refusalRowOf(parts, { goal: goal.id, workflow: parts.workflow }));
    if (refusedAt === undefined) {
      return [];
    }
    const later = observations.filter(({ at }) => at > refusedAt);
    const clearing = yield* Effect.forEach(later, ({ source }) =>
      Effect.map(observedSinceIn(parts, [observedEntryKeyOf(source)], refusedAt), (counted) =>
        counted ? [] : [source.record],
      ),
    );
    return clearing.flat();
  });
}

function executedWith(parts: DeliveryParts, planned: AssessmentPlanned, clearing: readonly string[]) {
  return Effect.suspend(() => {
    const acting = actingNow(parts);
    let appended = false;
    const { assessment, goal, goalsVersion, observations } = planned;
    return Effect.map(
      parts.ledger.execute(
        `${streamPrefixOfPlaybook(parts.playbook)}${assessmentsKind}/${assessment}`,
        assessmentDecider(acting, (decided) => {
          appended = decided;
        }),
        { goal, goalsVersion, observations, now: acting.at, clearing },
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

function observedSinceIn(parts: DeliveryParts, observedKeys: readonly string[], at: unknown) {
  return Effect.map(
    Effect.forEach(observedKeys, (key) =>
      parts.ledger.countProjectedRows(observationsName, parts.playbook, [
        { column: 'row_key', equals: key },
        { column: 'observed_at', after: Number(at) },
      ]),
    ),
    (counts: readonly number[]) => counts.some((count) => count > 0),
  );
}

function refused(parts: DeliveryParts, { refused: refusal, endedAt, observedKeys }: RefusalPlanned) {
  return Effect.gen(function* () {
    const acting = { by: playbookCallerOf(parts.playbook).id, at: endedAt };
    const id = refusalStreamIdOf(refusal);
    const kept = yield* refusalRowOf(parts, refusal);
    const status = refusalStatus(kept, refusal, endedAt);
    if (
      status === 'recorded' ||
      (status === 'standing' && !(yield* observedSinceIn(parts, observedKeys, kept?.['at'])))
    ) {
      return;
    }
    yield* parts.ledger.execute(
      `${streamPrefixOfPlaybook(parts.playbook)}${goalRefusalsKind}/${id}`,
      refusalDecider(acting),
      refusal,
    );
  });
}

export function deliveryOf(parts: DeliveryParts, planned: Planned): Delivery {
  const work: Effect.Effect<unknown, unknown> =
    'refused' in planned ? refused(parts, planned) : observed(parts, planned);
  return {
    key: planned.key,
    workflow: parts.workflow,
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
