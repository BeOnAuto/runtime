import type { RunMeter } from '@on.auto/definitions';
import { admittingMeter } from '@on.auto/definitions/testing';
import type { DispatcherServices, Fold, Ledger, ProjectedAddress, ProjectedKeyedRow } from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { DateTime, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';

import { MemoryFactSchema, type RecordedMemoryFact } from '../facts/memory-fact-schema.ts';
import { memoriesName, memoryRows } from '../projection/memory-rows.ts';

export const alpha = { org: 'acme', playbook: 'alpha' };

export const beta = { org: 'acme', playbook: 'beta' };

export const firstMoment = '2026-10-01T09:00:00.000Z';

export interface HarnessLedger {
  readonly service: Ledger['Service'];
  readonly layer: Layer.Layer<Ledger>;
}

export function aLedgerOfMemories(): HarnessLedger {
  return memoryLedger(undefined, [memoryRows]);
}

export type Ran = <A>(work: Effect.Effect<A, never, DispatcherServices>, at?: string) => Promise<A>;

export function ranWith(ledger: HarnessLedger, meter: Layer.Layer<RunMeter> = admittingMeter): Ran {
  const services = Layer.mergeAll(
    ledger.layer,
    memoryPlaybookRegistry([alpha, beta]),
    recordingReporter().layer,
    meter,
    TestClock.layer(),
  );
  return (work, at = firstMoment) =>
    Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
        Effect.andThen(work),
        Effect.provide(services),
      ),
    );
}

const everyFact: Fold<readonly RecordedMemoryFact[], RecordedMemoryFact> = {
  initialState: [],
  evolve: (facts, fact) => [...facts, fact],
  eventSchema: MemoryFactSchema,
};

const everyRow = { where: [], orderBy: ['written_at'], order: 'asc', limit: 1000 } as const;

export function rowsIn(ledger: HarnessLedger, address: ProjectedAddress): Promise<readonly ProjectedKeyedRow[]> {
  return Effect.runPromise(ledger.service.readProjectedRows(memoriesName, address, everyRow));
}

export function factsIn(ledger: HarnessLedger, stream: string): Promise<readonly RecordedMemoryFact[]> {
  return Effect.runPromise(Effect.map(ledger.service.load(stream, everyFact), ({ state }) => state));
}
