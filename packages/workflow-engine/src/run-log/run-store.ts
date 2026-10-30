import type { DecidedPlace, VersionConflict } from '@on.auto/ledger';
import type { Effect, Schema } from 'effect';

import type { StepKey } from '../steps/step-entry.ts';
import type { PositionedEvent, RunLogEvent } from './run-event.ts';
import type { Snapshot } from './snapshot.ts';

export interface StoredSnapshot {
  readonly snapshot: Snapshot;
  readonly bytes: number;
}

export interface StoredRun {
  readonly snapshot: StoredSnapshot | null;
  readonly tail: readonly PositionedEvent[];
}

export type RecordCause =
  | { readonly kind: 'start' }
  | { readonly kind: 'resumed'; readonly step: StepKey }
  | { readonly kind: 'timer'; readonly timerId: string }
  | { readonly kind: 'given'; readonly id: string }
  | { readonly kind: 'none' };

export interface RecordLineage {
  readonly cause: RecordCause;
  readonly attributes: Schema.JsonObject;
}

export interface RunLogStore {
  readonly load: (runId: string) => Effect.Effect<StoredRun>;
  readonly append: (
    runId: string,
    event: RunLogEvent,
    place: DecidedPlace,
    lineage: RecordLineage,
  ) => Effect.Effect<void, VersionConflict>;
  readonly eventsAfter: (runId: string, version: number) => Effect.Effect<readonly PositionedEvent[]>;
  readonly saveSnapshot: (snapshot: Snapshot) => Effect.Effect<void>;
}
