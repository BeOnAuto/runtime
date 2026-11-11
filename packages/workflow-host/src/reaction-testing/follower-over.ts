import { streamSignalOf } from '@on.auto/ledger';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import { filterStops } from '../filtering/filter-matching.ts';
import { factPayloadsOn } from '../ledger-testing/ledger-connections.ts';
import { systemClock } from '../loop/host-clock.ts';
import { startFollowing, type FollowingParts } from '../reactions/host-reactions.ts';
import { refusalsOn } from '../reactions/refusals.ts';
import { recordingReports } from '../testing/recording-reports.ts';
import { recordedReactions, type RecordedReactions } from './recorded-reactions.ts';

export async function followerOver(
  database: FollowingParts['database'],
  sweepEveryMs: number,
): Promise<RecordedReactions> {
  const reactions = recordedReactions();
  const { through: placeAtOpen } = await database.store.readAppended(undefined, 0);
  const follower = startFollowing({
    database,
    parts: {
      submitted: Effect.die,
      clock: systemClock,
      sweepEveryMs,
      reacting: { refusals: refusalsOn(database, Date.now), stops: filterStops() },
      calls: [],
      factPayloadsOf: factPayloadsOn(database),
    },
    reactions: { ...reactions.options, appended: streamSignalOf() },
    reports: recordingReports().reports,
    placeAtOpen,
  });
  onTestFinished(() => follower.stop());
  return reactions;
}
