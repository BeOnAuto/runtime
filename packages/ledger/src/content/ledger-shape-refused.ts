import { Data } from 'effect';

export interface RefusedShape {
  readonly table: string;
  readonly holds: string;
  readonly found: readonly string[];
  readonly kept: readonly string[];
}

export class LedgerShapeRefused extends Data.TaggedError('ledger_shape_refused')<
  RefusedShape & { readonly message: string }
> {}

export function ledgerShapeRefused({ table, holds, found, kept }: RefusedShape): LedgerShapeRefused {
  return new LedgerShapeRefused({
    table,
    holds,
    found,
    kept,
    message: `The ledger's database keeps ${holds} in a shape this server no longer reads: ${table} has the columns ${found.join(', ')}, where this server keeps ${kept.join(', ')}. Nothing stored before launch is carried over, so delete the local database and start the server again`,
  });
}
