import { streamAppends, type RecordedPoint } from '@on.auto/ledger';

import type { HostDatabase } from '../database/host-database.ts';
import { followerWorkOn, type FollowerAssembly } from '../follower/follower-assembly.ts';
import { startFollower, type Follower } from '../follower/follower-loop.ts';
import { followerWakeUpOf, type FollowerWork } from '../follower/follower-wake-up.ts';
import { playbookRecordsOf } from '../follower/playbook-records.ts';
import type { HostParts } from '../host/host-parts.ts';
import type { HostReports } from '../host/host-reports.ts';
import { systemClock } from '../loop/host-clock.ts';
import type { HostWakeUp, WakeSignal } from '../loop/host-wake-up.ts';

export type FollowerConsumers = FollowerAssembly['consumers'];

export interface FollowedParts extends Pick<HostParts, 'submitted' | 'clock' | 'sweepEveryMs' | 'context' | 'calls'> {
  readonly reacting: Pick<HostParts['reacting'], 'refusals' | 'stops'>;
}

export interface FollowingParts {
  readonly database: HostDatabase;
  readonly parts: FollowedParts;
  readonly reactions: FollowerAssembly['options'];
  readonly reports: HostReports;
  readonly placeAtOpen: RecordedPoint;
  readonly consumers?: FollowerConsumers | undefined;
}

function followerWorkOf({
  database,
  parts,
  reactions,
  reports,
  placeAtOpen,
  consumers = [],
}: FollowingParts): FollowerWork {
  const { submitted, clock, sweepEveryMs, context, reacting, calls } = parts;
  return followerWorkOn(
    { database, submitted, clock, sweepEveryMs, reports, context, placeAtOpen },
    {
      options: reactions,
      refusals: reacting.refusals,
      stops: reacting.stops,
      consumers,
      calls,
      records: playbookRecordsOf(database.store),
      appended: reactions.appended ?? streamAppends,
    },
  );
}

export function followerWakeUp(following: FollowingParts, signal: WakeSignal): HostWakeUp {
  return followerWakeUpOf(followerWorkOf(following), signal);
}

export function startFollowing(following: FollowingParts): Follower {
  return startFollower({ ...followerWorkOf(following), pace: systemClock });
}
