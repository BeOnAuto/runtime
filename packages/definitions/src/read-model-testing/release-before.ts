import { Ledger, type ProjectedKeyedRow, type ProjectedValue } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

function withoutTheColumn(column: string, { row, ...keyed }: ProjectedKeyedRow): ProjectedKeyedRow {
  return {
    ...keyed,
    row: Object.fromEntries(Object.entries(row).filter(([name]: readonly [string, ProjectedValue]) => name !== column)),
  };
}

export function answeringAsTheReleaseBefore(ledger: MemoryLedger, itsNewColumn: string): MemoryLedger {
  return {
    ...ledger,
    service: Ledger.of({
      ...ledger.service,
      readProjectedRows: (projection, address, query) =>
        Effect.map(ledger.service.readProjectedRows(projection, address, query), (rows) =>
          rows.map((each) => withoutTheColumn(itsNewColumn, each)),
        ),
    }),
  };
}
