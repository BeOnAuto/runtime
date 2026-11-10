import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { zoneClockOf } from '../schedules/zone-clock.ts';
import { triggersActivated } from '../triggers/trigger-rows.ts';
import { alpha, at, eventTrigger, type TriggerFilter } from './playbook-writes.ts';

export async function subscribedAt(
  database: HostDatabase,
  version: number,
  name: string,
  ...filters: readonly TriggerFilter[]
): Promise<void> {
  const activation = { workflow: name, version, activatedBy: `definition-${version}`, activatedAt: Date.parse(at) };
  await Effect.runPromise(
    triggersActivated(database, alpha, { ...activation, triggers: [eventTrigger(...filters)] }, zoneClockOf),
  );
}

export function subscribed(database: HostDatabase, name: string, ...filters: readonly TriggerFilter[]): Promise<void> {
  return subscribedAt(database, 1, name, ...filters);
}
