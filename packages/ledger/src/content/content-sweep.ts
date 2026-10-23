import { SQL } from '@event-driven-io/dumbo';
import { uuidV7TimeOf } from '@on.auto/operations';
import { Context, Effect } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { shelves, type Shelf } from './content-tables.ts';

export const unnamedChunksLastMs = 3_600_000;

export interface ContentSweeping {
  readonly sweepContent: (before: number) => Promise<void>;
}

export interface ChorePorts {
  readonly sweepOrphans: (now: number) => Effect.Effect<number>;
}

export class LedgerChores extends Context.Service<LedgerChores, ChorePorts>()('@on.auto/ledger/LedgerChores') {}

function sweptShelf(
  execute: StatementExecutor,
  { chunks, heads, placeColumns }: Shelf,
  before: string,
): Promise<unknown> {
  const sameUpload = SQL.merge(
    [...placeColumns, 'upload_id'].map(
      (column) =>
        SQL`${SQL.identifier(heads)}.${SQL.identifier(column)} = ${SQL.identifier(chunks)}.${SQL.identifier(column)}`,
    ),
    ' AND ',
  );
  return execute.command(
    SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE substr(upload_id, 1, 8) || substr(upload_id, 10, 4) < ${before}
      AND NOT EXISTS (SELECT 1 FROM ${SQL.identifier(heads)} WHERE ${sameUpload})`,
  );
}

export function contentSweepOn(execute: StatementExecutor): ContentSweeping['sweepContent'] {
  return (before) => inTurn(shelves, (shelf) => sweptShelf(execute, shelf, uuidV7TimeOf(before)));
}

export function orphansSweptOf({ sweepContent }: ContentSweeping): ChorePorts['sweepOrphans'] {
  return (now) =>
    Effect.uninterruptible(
      Effect.promise(() => sweepContent(now - unnamedChunksLastMs)).pipe(
        Effect.catchCause((cause) =>
          Effect.logError(
            'The ledger could not sweep what puts that never finished left of their content; it sweeps again in an hour',
            cause,
          ),
        ),
        Effect.as(now + unnamedChunksLastMs),
      ),
    );
}
