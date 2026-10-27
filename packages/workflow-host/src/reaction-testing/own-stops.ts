import type { Listeners } from '@on.auto/workflow-engine';

import type { HostDatabase } from '../database/host-database.ts';
import { filterStops } from '../filtering/filter-matching.ts';
import { sqlListeners } from '../listeners/sql-listeners.ts';
import { refusalsOn } from '../reactions/refusals.ts';
import { zoneClockOf } from '../schedules/zone-clock.ts';
import { definitionRecordsOn, type ApplyDefinitionRecord } from '../triggers/definition-records.ts';

export function listenersKeepingTheirOwnStops(database: HostDatabase): Listeners {
  return sqlListeners(database, refusalsOn(database, Date.now), filterStops());
}

export function definitionRecordsKeepingTheirOwnStops(database: HostDatabase): ApplyDefinitionRecord {
  return definitionRecordsOn(database, filterStops(), zoneClockOf);
}
