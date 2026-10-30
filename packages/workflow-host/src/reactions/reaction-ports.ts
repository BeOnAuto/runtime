import type { Emitter, Listeners } from '@on.auto/workflow-engine';

import type { HostDatabase } from '../database/host-database.ts';
import { ledgerEmitter } from '../emissions/ledger-emitter.ts';
import { filterStops, type FilterStops } from '../filtering/filter-matching.ts';
import { sqlListeners } from '../listeners/sql-listeners.ts';
import type { ReactionOptions } from './reaction-options.ts';
import { refusalsOn, type Refusals } from './refusals.ts';

export interface ReactionPorts {
  readonly listeners: Listeners;
  readonly emitter: Emitter;
  readonly refusals: Refusals;
  readonly stops: FilterStops;
}

export function reactionPortsOn(database: HostDatabase, options: ReactionOptions, now: () => number): ReactionPorts {
  const refusals = refusalsOn(database, now);
  const stops = filterStops();
  return {
    listeners: sqlListeners(database, refusals, stops),
    emitter: ledgerEmitter(options.emit, now),
    refusals,
    stops,
  };
}
