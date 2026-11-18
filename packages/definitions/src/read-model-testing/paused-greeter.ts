import { Ledger, type ProjectedKeyedRow } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { aReader, createdIn, executedIn } from './read-model-histories.ts';
import { readModelLedgerOf } from './read-model-ledger.ts';

function pointingAtThePause(rows: readonly ProjectedKeyedRow[]): readonly ProjectedKeyedRow[] {
  return rows.map((kept) => ({ ...kept, row: { ...kept.row, saved_position: 2, position: 2 } }));
}

export async function aPausedGreeterAlwaysWrong(playbook = 'alpha'): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(['echo']);
  await createdIn(ledger.service, 'greeter', playbook);
  await executedIn(ledger.service, 'echo', { type: 'pause', name: 'greeter', paused_by: aReader }, playbook);
  const service = Ledger.of({
    ...ledger.service,
    readProjectedRows: (projection, address, query) =>
      Effect.map(ledger.service.readProjectedRows(projection, address, query), pointingAtThePause),
  });
  return { ...ledger, service };
}
