import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { zoneClockOf } from '../schedules/zone-clock.ts';
import { triggersActivated } from '../triggers/trigger-rows.ts';
import {
  alpha,
  at,
  definitionKeyNamed,
  definitionRecorded,
  eventTrigger,
  type TriggerFilter,
} from './playbook-writes.ts';

export async function subscribedAt(
  database: HostDatabase,
  version: number,
  name: string,
  ...filters: readonly TriggerFilter[]
): Promise<void> {
  const triggers = [eventTrigger(...filters)];
  await definitionRecorded(database.store, { name, version, triggers });
  const activation = { version, activatedBy: `definition-${version}`, activatedAt: Date.parse(at), triggers };
  const place = { playbookKey: alpha, definitionKey: definitionKeyNamed(name) };
  await Effect.runPromise(triggersActivated(database, place, activation, zoneClockOf));
}

export function subscribed(database: HostDatabase, name: string, ...filters: readonly TriggerFilter[]): Promise<void> {
  return subscribedAt(database, 1, name, ...filters);
}
