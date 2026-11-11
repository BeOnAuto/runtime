import { Ledger, type ProjectedKeyedRow } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { definitionsReadModelOf } from '../read-model/definitions-read-model.ts';
import { aReader, createdIn, executedIn } from './read-model-histories.ts';

function pointingAtThePause(rows: readonly ProjectedKeyedRow[]): readonly ProjectedKeyedRow[] {
  return rows.map((kept) => ({ ...kept, row: { ...kept.row, saved_position: 2 } }));
}

interface AlwaysWrong {
  readonly ledger: MemoryLedger;
  readonly resets: () => number;
}

export async function aPausedGreeterAlwaysWrong(playbook = 'alpha'): Promise<AlwaysWrong> {
  const ledger = memoryLedger(undefined, [definitionsReadModelOf(['echo'])]);
  await createdIn(ledger.service, 'greeter', playbook);
  await executedIn(ledger.service, 'echo', { type: 'pause', name: 'greeter', paused_by: aReader }, playbook);
  let resets = 0;
  const service = Ledger.of({
    ...ledger.service,
    readProjectedRows: (projection, address, query) =>
      Effect.map(ledger.service.readProjectedRows(projection, address, query), pointingAtThePause),
    resetStreamProjection: (projection, address) =>
      Effect.andThen(
        Effect.sync(() => {
          resets += 1;
        }),
        ledger.service.resetStreamProjection(projection, address),
      ),
  });
  return { ledger: { ...ledger, service }, resets: () => resets };
}
