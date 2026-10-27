import { Effect } from 'effect';

import type { RecordConsumer } from '../follower/consumers.ts';
import type { FollowerHost } from '../follower/follower-host.ts';
import type { Upkeep } from '../follower/follower-wake-up.ts';
import { scheduleFiringOn } from '../schedules/schedule-firing.ts';
import { zoneClockOf } from '../schedules/zone-clock.ts';
import { definitionRecordsOn, type ApplyDefinitionRecord } from '../triggers/definition-records.ts';
import { reactionConsumersOf, type ReactionUse } from './reaction-consumers.ts';
import { startingOn } from './start-rates.ts';

export interface Reacting {
  readonly consumers: readonly RecordConsumer[];
  readonly applyDefinitionRecord: ApplyDefinitionRecord;
  readonly upkeep: Upkeep;
}

export function reactingOn(host: FollowerHost, use: ReactionUse): Reacting {
  const { database, clock, reports } = host;
  const { options, refusals } = use;
  const inZone = clock.inZone ?? zoneClockOf;
  const starting = startingOn(database, options.start, refusals, clock.now);
  const schedules = scheduleFiringOn({
    database,
    reports,
    clock: { now: clock.now, inZone },
    start: options.start,
    refusals,
  });
  return {
    consumers: reactionConsumersOf(host, use, starting),
    applyDefinitionRecord: definitionRecordsOn(database, use.stops, inZone),
    upkeep: {
      sweep: () => Effect.asVoid(Effect.andThen(starting.startDeferred(), refusals.flush())),
      fireSchedules: () => Effect.asVoid(schedules.fireDue()),
      nextScheduleAt: schedules.nextDueAt,
    },
  };
}
