import { describeError, type DslError, type FilterVerdict } from '@on.auto/workflow-engine';
import { Array, Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import {
  groupMatchingOf,
  stopsInARowBeforeTheVersion,
  type FilterPlace,
  type FilterStops,
  type MatchFilters,
  type MatchGroups,
} from '../filtering/filter-matching.ts';
import {
  DeliveryFailed,
  deliverySweeps,
  type RecordConsumer,
  type Delivery,
  type FollowedRecord,
} from '../follower/consumers.ts';
import { eventSubscriptionsOf, namedByTheirDefinitions, type EventSubscription } from '../triggers/trigger-rows.ts';
import { reactionRunIdOf } from './reaction-ids.ts';
import { codesOf, type FailureDetail, type Refusal, type RefuseReaction, type RejectionCodes } from './refusals.ts';
import type { WorkflowOfRun } from './run-workflows.ts';
import type { Starting } from './start-rates.ts';

export const mostReactionDepth = 8;

export interface StartParts {
  readonly database: HostDatabase;
  readonly starting: Starting;
  readonly refusals: RefuseReaction;
  readonly workflowOfRun: WorkflowOfRun;
  readonly match: MatchFilters;
  readonly stops: FilterStops;
  readonly now: () => number;
}

interface NamedSubscription extends EventSubscription {
  readonly playbookKey: string;
  readonly workflow: string;
}

type Verdict = 'matched' | 'unmatched' | { readonly error: string };

interface SubscriptionVerdict {
  readonly subscription: NamedSubscription;
  readonly place: FilterPlace;
  readonly verdict: Verdict;
  readonly stopped: readonly DslError[];
  readonly struck: boolean;
}

function verdictOf(verdicts: readonly FilterVerdict[]): Verdict {
  if (verdicts.includes(true)) {
    return 'matched';
  }
  const failed = verdicts.find((verdict) => typeof verdict === 'object' && !verdict.stopped);
  return typeof failed === 'object' ? { error: describeError(failed.error) } : 'unmatched';
}

function placeOf(playbookKey: string, { workflow, version, reference }: NamedSubscription): FilterPlace {
  return { kind: 'trigger', playbookKey, workflow, version, reference };
}

function refusalOf(
  { definitionKey, workflow, version, reference }: NamedSubscription,
  reason: string,
  codes: RejectionCodes = {},
): Refusal {
  return { definitionKey, workflow, version, trigger: { kind: 'event', reference }, reason, ...codesOf(codes) };
}

function unstarted(subscription: NamedSubscription, failure: FailureDetail): Refusal {
  return refusalOf(subscription, `The workflow could not be started by its event trigger: ${failure.detail}`, failure);
}

function verdictsOf(
  matchGroups: MatchGroups,
  parts: StartParts,
  subscriptions: readonly NamedSubscription[],
  { playbookKey, event: { event } }: FollowedRecord,
): Effect.Effect<readonly SubscriptionVerdict[]> {
  const groups = subscriptions.map((subscription) => ({
    place: placeOf(playbookKey, subscription),
    filters: subscription.filters,
  }));
  return Effect.map(matchGroups(groups, event, parts.now()), (matched) =>
    Array.zipWith(subscriptions, matched, (subscription, { verdicts, stopped, struck }): SubscriptionVerdict => ({
      subscription,
      place: placeOf(playbookKey, subscription),
      verdict: verdictOf(verdicts),
      stopped,
      struck,
    })),
  );
}

function isOwn(parts: StartParts, workflow: string, { playbookKey, event }: FollowedRecord): Effect.Effect<boolean> {
  if (event.ownedBy.includes(workflow)) {
    return Effect.succeed(true);
  }
  return event.topRun === undefined
    ? Effect.succeed(false)
    : Effect.map(parts.workflowOfRun(playbookKey, event.topRun), (owner) => owner === workflow);
}

function tracedBy({ traceId, spanId }: FollowedRecord['record']) {
  return traceId === undefined || spanId === undefined ? {} : { trace: { traceId, spanId } };
}

function startOf(parts: StartParts, subscription: NamedSubscription, followed: FollowedRecord): Delivery {
  const { playbook, playbookKey, record, event } = followed;
  const { definitionKey, workflow, version, reference } = subscription;
  return {
    key: definitionKey,
    workflow,
    skipped: (failure) => parts.refusals.refuse(playbookKey, unstarted(subscription, failure)),
    deliver:
      event.depth > mostReactionDepth
        ? parts.refusals.refuse(
            playbookKey,
            refusalOf(
              subscription,
              `An event matched the event trigger of the workflow at reaction depth ${event.depth}, past the ${mostReactionDepth} a chain of reactions may reach`,
            ),
          )
        : parts.starting.start(playbookKey, {
            ...playbook,
            definitionKey,
            workflow,
            version,
            runId: reactionRunIdOf(definitionKey, version, reference, record.id),
            input: [event.event],
            depth: event.depth,
            cause: record.id,
            trigger: { kind: 'event', reference },
            ...tracedBy(record),
          }),
  };
}

function matchedLater(parts: StartParts, playbookKey: string, subscription: NamedSubscription): Delivery {
  const { definitionKey, workflow } = subscription;
  return {
    key: definitionKey,
    workflow,
    skipped: (failure) => parts.refusals.refuse(playbookKey, unstarted(subscription, failure)),
    deliver: Effect.fail(
      new DeliveryFailed({
        detail:
          "The filter of the workflow's event trigger was stopped on the event by its deadline or its memory, so the event waits to be matched again",
      }),
    ),
  };
}

function deliveriesOf(parts: StartParts, judged: SubscriptionVerdict, followed: FollowedRecord) {
  const { subscription, verdict, struck } = judged;
  if (verdict !== 'matched') {
    return Effect.succeed(struck ? [matchedLater(parts, followed.playbookKey, subscription)] : []);
  }
  return Effect.map(isOwn(parts, subscription.workflow, followed), (own) =>
    own ? [] : [startOf(parts, subscription, followed)],
  );
}

function reported(parts: StartParts, { place, verdict, stopped, subscription }: SubscriptionVerdict) {
  const { playbookKey } = place;
  return Effect.andThen(
    Effect.forEach(
      stopped,
      (error) =>
        parts.refusals.refuse(
          playbookKey,
          refusalOf(
            subscription,
            `The filter of the workflow's event trigger was stopped by its deadline or its memory ${stopsInARowBeforeTheVersion} times in a row, so it is not evaluated again for this version of the workflow; a new version evaluates it again: ${describeError(error)}`,
          ),
        ),
      { discard: true },
    ),
    typeof verdict === 'object' && parts.stops.failedFirst(place)
      ? parts.refusals.refuse(
          playbookKey,
          refusalOf(
            subscription,
            `The filter of the workflow's event trigger failed on an event, so it did not match: ${verdict.error}`,
          ),
        )
      : Effect.void,
  );
}

export function subscriptionStarts(parts: StartParts): RecordConsumer {
  const matchGroups = groupMatchingOf(parts.match, parts.stops);
  return {
    name: 'subscription_starts',
    skippedAfterSweeps: deliverySweeps,
    batchOf: (followed, after, most) =>
      Effect.gen(function* () {
        const type = followed.event.event.type;
        const { playbookKey } = followed;
        const candidates = yield* eventSubscriptionsOf(parts.database, playbookKey, { type, after, most });
        const taken = candidates.slice(0, most);
        const named = yield* namedByTheirDefinitions(
          parts.database,
          taken.map((subscription) => ({ ...subscription, playbookKey })),
        );
        const judged = yield* verdictsOf(matchGroups, parts, named, followed);
        yield* Effect.forEach(judged, (each) => reported(parts, each), { discard: true });
        const deliveries = yield* Effect.forEach(judged, (each) => deliveriesOf(parts, each, followed));
        return {
          deliveries: deliveries.flat(),
          through: taken.at(-1)?.definitionKey,
          more: candidates.length > most,
        };
      }),
  };
}
