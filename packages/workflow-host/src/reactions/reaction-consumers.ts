import { filterMatchingOf, type FilterStops } from '../filtering/filter-matching.ts';
import type { RecordConsumer } from '../follower/consumers.ts';
import type { FollowerHost } from '../follower/follower-host.ts';
import { addressOfRun } from '../runs/run-address.ts';
import { listenerOffers } from './listener-offers.ts';
import type { ReactionOptions } from './reaction-options.ts';
import type { Refusals } from './refusals.ts';
import { workflowsOfRuns } from './run-workflows.ts';
import type { Starting } from './start-rates.ts';
import { subscriptionStarts } from './subscription-starts.ts';

export interface ReactionUse {
  readonly options: ReactionOptions;
  readonly refusals: Refusals;
  readonly stops: FilterStops;
}

export function reactionConsumersOf(
  host: Pick<FollowerHost, 'database' | 'submitted' | 'clock' | 'reports'>,
  { options, refusals, stops }: ReactionUse,
  starting: Starting,
): readonly RecordConsumer[] {
  const { database, clock, reports } = host;
  const match = filterMatchingOf(options.filters);
  const offers = listenerOffers({
    database,
    refusals,
    offer: ({ runKey, key, listener, event }) =>
      host.submitted({ kind: 'event_offered', runId: runKey, at: clock.now(), key, listener, event }),
    declined: (runKey, detail) => reports.note({ kind: 'offer_declined', run: addressOfRun(runKey), detail }),
    match,
    stops,
    now: clock.now,
  });
  const starts = subscriptionStarts({
    database,
    starting,
    refusals,
    workflowOfRun: workflowsOfRuns((stream) => database.store.read(stream, 0), options.definitionType),
    match,
    stops,
    now: clock.now,
  });
  return [offers, starts];
}
