import { Ledger, type ProjectedKeyedRow } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aReader, createdIn, executedIn } from '../read-model-testing/read-model-histories.ts';
import { definitionsReadModelOf } from '../read-model/definitions-read-model.ts';
import { registeredFromTheReadModel } from './read-model-stored.ts';
import { versionFromTheReadModel } from './read-model-versions.ts';

function pointingAtThePause(rows: readonly ProjectedKeyedRow[]): readonly ProjectedKeyedRow[] {
  return rows.map((kept) => ({ ...kept, row: { ...kept.row, saved_position: 2, position: 2 } }));
}

function wrongUntilReset(ledger: MemoryLedger, resets: number): MemoryLedger {
  let reset = 0;
  const service = Ledger.of({
    ...ledger.service,
    readProjectedRows: (projection, address, query) =>
      Effect.map(ledger.service.readProjectedRows(projection, address, query), (rows) =>
        reset < resets ? pointingAtThePause(rows) : rows,
      ),
    resetStreamProjection: (projection, address) =>
      Effect.andThen(
        Effect.sync(() => {
          reset += 1;
        }),
        ledger.service.resetStreamProjection(projection, address),
      ),
  });
  return { ...ledger, service };
}

async function aPausedGreeter(): Promise<MemoryLedger> {
  const ledger = memoryLedger(undefined, [definitionsReadModelOf(['echo'])]);
  await createdIn(ledger.service, 'greeter');
  await executedIn(ledger.service, 'echo', { type: 'pause', name: 'greeter', paused_by: aReader });
  return ledger;
}

describe('a row of the read model whose position names no save of its version', () => {
  it('resets the read model once and answers from the rows built again', async () => {
    const ledger = await aPausedGreeter();

    expect([
      (await inThePlaybook(wrongUntilReset(ledger, 1), registeredFromTheReadModel('echo', 'greeter')))?.stored.status,
      (await inThePlaybook(wrongUntilReset(ledger, 1), versionFromTheReadModel('echo', 'greeter', 1))).putInPlaceBy,
    ]).toEqual(['paused', aReader.id]);
  });
});
