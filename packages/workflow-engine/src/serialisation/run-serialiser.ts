import type { Effect } from 'effect';

export interface RunSerialiser {
  readonly serialise: <A, E, R>(runId: string, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}
