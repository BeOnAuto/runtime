import { Ledger, type ProjectedKeyedRow } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { aReader, createdIn, executedIn } from './read-model-histories.ts';
import { readModelLedgerOf } from './read-model-ledger.ts';

export async function aTargetReadByAUser(): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(['echo']);
  await createdIn(ledger.service, 'target');
  await executedIn(ledger.service, 'echo', {
    type: 'create',
    name: 'user',
    content: { source: '{}', details: { reads: [{ type: 'echo', name: 'target' }] } },
    created_by: aReader,
    definition_id: 'id-of-the-user',
  });
  return ledger;
}

function readingAs(
  ledger: MemoryLedger,
  rowsOf: (projection: string, rows: readonly ProjectedKeyedRow[]) => readonly ProjectedKeyedRow[],
): MemoryLedger {
  return {
    ...ledger,
    service: Ledger.of({
      ...ledger.service,
      readProjectedRows: (projection, address, query) =>
        Effect.map(ledger.service.readProjectedRows(projection, address, query), (rows) => rowsOf(projection, rows)),
    }),
  };
}

export function underNoDefinition(ledger: MemoryLedger): MemoryLedger {
  return readingAs(ledger, (_projection, rows) => rows.map(({ definition: _definition, ...row }) => row));
}

export function withNoRowOfADefinition(ledger: MemoryLedger): MemoryLedger {
  return readingAs(ledger, (projection, rows) => (projection === 'definitions' ? [] : rows));
}
