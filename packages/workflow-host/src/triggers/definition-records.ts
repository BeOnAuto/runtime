import { definitionChangeOf } from '@on.auto/definitions';
import type { RecordedStream } from '@on.auto/ledger';
import type { RecordedEvent } from '@on.auto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { FilterStops } from '../filtering/filter-matching.ts';
import type { InZone } from '../schedules/zone-clock.ts';
import { triggersActivated, triggersRemoved } from './trigger-rows.ts';

export type DefinitionRecord = Pick<RecordedEvent, 'id' | 'type' | 'data' | 'context'>;

type DefinitionApplied = 'applied' | 'unreadable';

export type ApplyDefinitionRecord = (playbookKey: string, record: DefinitionRecord) => Effect.Effect<DefinitionApplied>;

export function definitionRecordsOn(database: HostDatabase, stops: FilterStops, inZone: InZone): ApplyDefinitionRecord {
  return (playbookKey, record) => {
    const { id } = record;
    const change = definitionChangeOf(record);
    if (change.kind === 'activated') {
      const { name: workflow, version, triggers, at } = change;
      const activation = { workflow, version, triggers, activatedBy: id, activatedAt: Date.parse(at) };
      stops.activated(playbookKey, workflow, version);
      return Effect.as(triggersActivated(database, playbookKey, activation, inZone), 'applied');
    }
    if (change.kind === 'deactivated') {
      stops.retired(playbookKey, change.name);
      return Effect.as(triggersRemoved(database, playbookKey, change.name), 'applied');
    }
    return Effect.succeed(change.kind === 'unreadable' ? 'unreadable' : 'applied');
  };
}

export function definitionRecordsIn({ messages }: RecordedStream): readonly DefinitionRecord[] {
  return messages.map(({ type, data, context, lineage }) => ({ id: lineage.id, type, data, context }));
}
