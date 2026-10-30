import type { Conflict } from '@on.auto/operations';
import {
  describeError,
  listenerFilterOf,
  type CallKey,
  type DslError,
  type MatchedFilter,
  type Submission,
} from '@on.auto/workflow-engine';
import { Array, Effect, Schema } from 'effect';

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
import {
  listenerKeyOf,
  listenersOfType,
  type ListenerPlace,
  type MatchedListener,
} from '../listeners/listener-rows.ts';
import { addressOfRun } from '../runs/run-address.ts';
import type { RefuseReaction } from './refusals.ts';

interface ListenerVerdict {
  readonly row: MatchedListener;
  readonly accepted: boolean;
  readonly stopped: readonly DslError[];
  readonly struck: boolean;
}

interface Offer {
  readonly runKey: string;
  readonly key: string;
  readonly listener: CallKey;
  readonly event: FollowedRecord['event']['event'];
}

export interface OfferParts {
  readonly database: HostDatabase;
  readonly refusals: RefuseReaction;
  readonly offer: (offer: Offer) => Effect.Effect<Submission, Conflict | Readonly<{ detail: string }>>;
  readonly declined: (runKey: string, detail: string) => Effect.Effect<void>;
  readonly match: MatchFilters;
  readonly stops: FilterStops;
  readonly now: () => number;
}

const PlaceSchema = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String]));

const FiltersSchema = Schema.fromJsonString(Schema.Array(Schema.JsonObject));

const nowhere: ListenerPlace = { runKey: '', listener: '' };

function placeOf(after: string | undefined): ListenerPlace {
  if (after === undefined) {
    return nowhere;
  }
  const [runKey, listener] = Schema.decodeUnknownSync(PlaceSchema)(after);
  return { runKey, listener };
}

function keyOf(row: MatchedListener): string {
  return JSON.stringify([row.run_key, row.listener]);
}

function filterPlaceOf(playbookKey: string, row: MatchedListener): FilterPlace {
  const { workflow, version } = row;
  return { kind: 'listener', playbookKey, workflow, version, reference: listenerKeyOf(row.listener).reference };
}

function filtersOf(row: MatchedListener): readonly MatchedFilter[] {
  return Schema.decodeUnknownSync(FiltersSchema)(row.filters).flatMap((attributes) => {
    const filter = listenerFilterOf(attributes, row.listener);
    return filter === undefined ? [] : [filter];
  });
}

function accepting(
  matchGroups: MatchGroups,
  parts: OfferParts,
  rows: readonly MatchedListener[],
  { playbookKey, event }: FollowedRecord,
): Effect.Effect<readonly ListenerVerdict[]> {
  const groups = rows.map((row) => ({ place: filterPlaceOf(playbookKey, row), filters: filtersOf(row) }));
  return Effect.map(matchGroups(groups, event.event, parts.now()), (matched) =>
    Array.zipWith(rows, matched, (row, { verdicts, stopped, struck }): ListenerVerdict => ({
      row,
      accepted: verdicts.includes(true),
      stopped,
      struck,
    })),
  );
}

function reportedStops(parts: OfferParts, playbookKey: string, { row, stopped }: ListenerVerdict) {
  return Effect.forEach(
    stopped,
    (error) =>
      parts.refusals.refuse(
        playbookKey,
        row,
        `The filter of a listen task of the workflow was stopped by its deadline or its memory ${stopsInARowBeforeTheVersion} times in a row, so the playbook's events are not offered through it again for this version of the workflow; events sent to its runs still reach them: ${describeError(error)}`,
      ),
    { discard: true },
  );
}

function skippedOffer(parts: OfferParts, row: MatchedListener, { playbookKey }: FollowedRecord) {
  return (detail: string) =>
    parts.refusals.refuse(playbookKey, row, `An event could not be offered to a run waiting for it: ${detail}`);
}

function offeredLater(parts: OfferParts, row: MatchedListener, followed: FollowedRecord): Delivery {
  return {
    key: keyOf(row),
    workflow: row.workflow,
    skipped: skippedOffer(parts, row, followed),
    deliver: Effect.fail(
      new DeliveryFailed({
        detail:
          "The filter of a run's listen task was stopped on the event by its deadline or its memory, so the event waits to be matched again",
      }),
    ),
  };
}

function deliveriesOf(parts: OfferParts, { row, accepted, struck }: ListenerVerdict, followed: FollowedRecord) {
  if (accepted) {
    return [offerOf(parts, row, followed)];
  }
  return struck ? [offeredLater(parts, row, followed)] : [];
}

function emittedByTheRun(row: MatchedListener, { event }: FollowedRecord): boolean {
  return event.emitter?.runId === addressOfRun(row.run_key).runId;
}

function offerOf(parts: OfferParts, row: MatchedListener, followed: FollowedRecord): Delivery {
  return {
    key: keyOf(row),
    workflow: row.workflow,
    skipped: skippedOffer(parts, row, followed),
    deliver: parts
      .offer({
        runKey: row.run_key,
        key: followed.record.id,
        listener: listenerKeyOf(row.listener),
        event: followed.event.event,
      })
      .pipe(
        Effect.flatMap(({ declined }) =>
          declined === undefined ? Effect.void : parts.declined(row.run_key, declined),
        ),
        Effect.mapError(({ detail }: Readonly<{ detail: string }>) => new DeliveryFailed({ detail })),
      ),
  };
}

export function listenerOffers(parts: OfferParts): RecordConsumer {
  const matchGroups = groupMatchingOf(parts.match, parts.stops);
  return {
    name: 'listener_offers',
    skippedAfterSweeps: deliverySweeps,
    batchOf: (followed, after, most) =>
      Effect.gen(function* () {
        const rows = yield* listenersOfType(parts.database, {
          playbookKey: followed.playbookKey,
          type: followed.event.event.type,
          after: placeOf(after),
          limit: most + 1,
        });
        const taken = rows.slice(0, most);
        const others = taken.filter((row) => !emittedByTheRun(row, followed));
        const judged = yield* accepting(matchGroups, parts, others, followed);
        yield* Effect.forEach(judged, (each) => reportedStops(parts, followed.playbookKey, each), { discard: true });
        const lastTaken = taken.at(-1);
        return {
          deliveries: judged.flatMap((each) => deliveriesOf(parts, each, followed)),
          through: lastTaken === undefined ? undefined : keyOf(lastTaken),
          more: rows.length > most,
        };
      }),
  };
}
