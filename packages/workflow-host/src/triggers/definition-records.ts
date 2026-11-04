import { definitionChangeOf } from '@on.auto/definitions';
import type { RecordedStream } from '@on.auto/ledger';
import type { RecordedEvent } from '@on.auto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { FilterStops } from '../filtering/filter-matching.ts';
import type { InZone } from '../schedules/zone-clock.ts';
import {
  triggersActivated,
  triggersPaused,
  triggersRemoved,
  triggersResumed,
  triggersRetired,
} from './trigger-rows.ts';

export type DefinitionRecord = Pick<RecordedEvent, 'id' | 'type' | 'data' | 'context'>;

type DefinitionApplied = 'applied' | 'unreadable';

export type ApplyDefinitionRecord = (playbookKey: string, record: DefinitionRecord) => Effect.Effect<DefinitionApplied>;

export function definitionRecordsOn(database: HostDatabase, stops: FilterStops, inZone: InZone): ApplyDefinitionRecord {
  return (playbookKey, record) => {
    const { id } = record;
    const change = definitionChangeOf(record);
    if (change.kind === 'activated' || change.kind === 'restored') {
      const { name: workflow, version, triggers, at } = change;
      const activation = { workflow, version, triggers, activatedBy: id, activatedAt: Date.parse(at) };
      stops.activated(playbookKey, workflow, version);
      const activated = triggersActivated(database, playbookKey, activation, inZone);
      return Effect.as(
        change.kind === 'restored'
          ? Effect.andThen(triggersPaused(database, playbookKey, workflow), activated)
          : activated,
        'applied',
      );
    }
    if (change.kind === 'deactivated' || change.kind === 'retired') {
      stops.retired(playbookKey, change.name);
      const removed = change.kind === 'retired' ? triggersRetired : triggersRemoved;
      return Effect.as(removed(database, playbookKey, change.name), 'applied');
    }
    if (change.kind === 'paused') {
      return Effect.as(triggersPaused(database, playbookKey, change.name), 'applied');
    }
    if (change.kind === 'resumed') {
      const resumption = { workflow: change.name, resumedAt: Date.parse(change.at) };
      return Effect.as(triggersResumed(database, playbookKey, resumption, inZone), 'applied');
    }
    return Effect.succeed(change.kind === 'unreadable' ? 'unreadable' : 'applied');
  };
}

export function definitionRecordsIn({ messages }: RecordedStream): readonly DefinitionRecord[] {
  return messages.map(({ type, data, context, lineage }) => ({ id: lineage.id, type, data, context }));
}
