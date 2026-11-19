import { definitionChangeOf, type DefinitionChange } from '@on.auto/definitions';
import type { RecordedStream } from '@on.auto/ledger';
import { definitionOfStreamPrefix, streamPrefixOfPlaybook, type RecordedEvent } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { FilterStops } from '../filtering/filter-matching.ts';
import type { InZone } from '../schedules/zone-clock.ts';
import { triggersMoved } from './moved-triggers.ts';
import {
  triggersActivated,
  triggersPaused,
  triggersRemoved,
  triggersResumed,
  triggersRetired,
  type DefinitionPlace,
} from './trigger-rows.ts';

export type DefinitionRecord = Pick<RecordedEvent, 'id' | 'type' | 'data' | 'context'>;

type DefinitionApplied = 'applied' | 'unreadable';

export type ApplyDefinitionRecord = (
  place: DefinitionPlace,
  record: DefinitionRecord,
) => Effect.Effect<DefinitionApplied>;

type Activation = Extract<DefinitionChange, { readonly triggers: unknown }>;

type Moved = Extract<DefinitionChange, { readonly kind: 'moved' }>;

function movedOn(database: HostDatabase, stops: FilterStops) {
  return ({ definitionKey }: DefinitionPlace, { name, from, to }: Moved): Effect.Effect<DefinitionApplied> =>
    Option.match(definitionOfStreamPrefix(definitionKey), {
      onNone: () => Effect.succeed('unreadable'),
      onSome: ({ org }) => {
        const moved = streamPrefixOfPlaybook({ org, playbook: to });
        stops.moved(streamPrefixOfPlaybook({ org, playbook: from }), moved, name);
        return Effect.as(triggersMoved(database, definitionKey, moved), 'applied');
      },
    });
}

function isActivation(change: DefinitionChange): change is Activation {
  return 'triggers' in change;
}

export function definitionRecordsOn(database: HostDatabase, stops: FilterStops, inZone: InZone): ApplyDefinitionRecord {
  const moved = movedOn(database, stops);
  return (place, record) => {
    const { id } = record;
    const { playbookKey } = place;
    const change = definitionChangeOf(record);
    if (isActivation(change)) {
      const { name: workflow, version, triggers, at } = change;
      const activation = { version, triggers, activatedBy: id, activatedAt: Date.parse(at) };
      stops.activated(playbookKey, workflow, version);
      const activated = triggersActivated(database, place, activation, inZone);
      return Effect.as(
        change.kind === 'activated' ? activated : Effect.andThen(triggersPaused(database, place), activated),
        'applied',
      );
    }
    if (change.kind === 'deactivated' || change.kind === 'retired') {
      stops.retired(playbookKey, change.name);
      const removed = change.kind === 'retired' ? triggersRetired : triggersRemoved;
      return Effect.as(removed(database, place), 'applied');
    }
    if (change.kind === 'paused') {
      return Effect.as(triggersPaused(database, place), 'applied');
    }
    if (change.kind === 'resumed') {
      return Effect.as(triggersResumed(database, place, Date.parse(change.at), inZone), 'applied');
    }
    if (change.kind === 'moved') {
      return moved(place, change);
    }
    return Effect.succeed(change.kind === 'unreadable' ? 'unreadable' : 'applied');
  };
}

export function definitionRecordsIn({ messages }: RecordedStream): readonly DefinitionRecord[] {
  return messages.map(({ type, data, context, lineage }) => ({ id: lineage.id, type, data, context }));
}
