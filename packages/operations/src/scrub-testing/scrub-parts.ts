import { Effect, type Schema } from 'effect';

import type {
  Context,
  FactScrub,
  Fold,
  KeyedProjection,
  LedgerPorts,
  ProjectedAddress,
  ProjectedRowsQuery,
  RunOutcomeMapping,
  ScrubRefusedBecause,
} from '../index.ts';
import { RemarkFactSchema, remarkFacts, type RemarkFact } from '../projections/remark-rows.ts';

export interface FactScrubEntry {
  readonly aLedger: (projections: readonly KeyedProjection[], runOutcomes?: RunOutcomeMapping) => Promise<LedgerPorts>;
}

type RecordedRemark = typeof RemarkFactSchema.Type;

export const alpha = { org: 'acme', playbook: 'alpha' };

export const acme = { org: 'acme' };

export const remarks = 'playbook/acme/alpha/remarks/r1';

export const erasedContext: Context = { at: '2026-10-06T09:00:00.000Z', by: 'eraser' };

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 10 };

const allRemarks: Fold<readonly RecordedRemark[], RecordedRemark> = {
  initialState: [],
  evolve: (facts, fact) => [...facts, fact],
  eventSchema: RemarkFactSchema,
};

export function made(text: string): RemarkFact {
  return { type: 'remark_made', data: { text } };
}

export function remarked(ledger: LedgerPorts, stream: string, ...facts: readonly RemarkFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, remarkFacts, facts));
}

export function erasing(position: number, data: Schema.JsonObject): FactScrub<RecordedRemark> {
  return {
    eventSchema: RemarkFactSchema,
    data,
    erasure: { type: 'remark_erased', data: { position } },
    context: erasedContext,
  };
}

export function erasedAt(position: number): FactScrub<RecordedRemark> {
  return erasing(position, { text: '' });
}

export function scrubbed(ledger: LedgerPorts, stream: string, position: number, scrub = erasedAt(position)) {
  return Effect.runPromise(Effect.result(ledger.scrubFact(stream, position, scrub)));
}

export function refusalOf(ledger: LedgerPorts, stream: string, position: number, scrub = erasedAt(position)) {
  return Effect.runPromise(
    ledger.scrubFact(stream, position, scrub).pipe(
      Effect.as('scrubbed'),
      Effect.catchTag('scrub_refused', ({ because }: { readonly because: ScrubRefusedBecause }) =>
        Effect.succeed(because),
      ),
    ),
  );
}

export function remarksIn(ledger: LedgerPorts, stream: string) {
  return Effect.runPromise(ledger.load(stream, allRemarks));
}

export function rowsOf(ledger: LedgerPorts, projection: string, address: ProjectedAddress) {
  return Effect.runPromise(ledger.readProjectedRows(projection, address, everyRow));
}
