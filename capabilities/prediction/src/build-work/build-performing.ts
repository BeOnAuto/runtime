import { runEnded, runSettler, workRecorder, type Settlement } from '@on.auto/definitions';
import type { Lineage, Unavailable } from '@on.auto/operations';
import { Effect, Equal, type Schema } from 'effect';

import { predictionBuildsName, type BuildRow } from '../builds/build-rows.ts';
import type { BuildState } from '../builds/build-state.ts';
import type { PredictionPorts, StartChild } from '../capability/prediction-ports.ts';
import { buildRunFacts } from '../facts/prediction-facts.ts';

export interface Performing {
  readonly ports: PredictionPorts;
  readonly runs: StartChild;
  readonly row: BuildRow;
  readonly build: BuildState;
  readonly lineage: Lineage;
  readonly now: number;
}

export const aMinute = 60_000;

export type PerformedStep = Effect.Effect<void, Unavailable>;

function endedMeanwhile(error: unknown): boolean {
  return Equal.equals(error, runEnded);
}

export function advanced(
  { ports, row, build }: Performing,
  set: { readonly next_due_at?: number | null; readonly staged?: boolean },
): Effect.Effect<void> {
  const { org, playbook, id } = build.address;
  return ports.ledger.advanceRow(predictionBuildsName, { org, playbook }, id, {
    set,
    when: [{ column: 'cause', equals: row.cause }],
  });
}

export function restingUntil(performing: Performing, at: number | null): Effect.Effect<void> {
  return advanced(performing, { next_due_at: at });
}

export function recordedWork(
  { ports, build, lineage }: Performing,
  fact: { readonly type: string; readonly data: Schema.JsonObject },
): Effect.Effect<void> {
  const record = workRecorder(ports.ledger, buildRunFacts);
  return record(build.address, { type: 'work', fact }, lineage).pipe(
    Effect.asVoid,
    Effect.catchIf(endedMeanwhile, () => Effect.void),
    Effect.orDie,
  );
}

export function settledBuild({ ports, build, lineage }: Performing, settlement: Settlement): Effect.Effect<void> {
  return runSettler(ports.ledger)(build.address, settlement, lineage).pipe(
    Effect.asVoid,
    Effect.catchTag('conflict', () => Effect.void),
    Effect.orDie,
  );
}
