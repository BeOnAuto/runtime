import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import {
  aGeneratedHistory,
  definitionsIn,
  foldedVersionIn,
  savedVersionsIn,
} from '../read-model-testing/read-model-histories.ts';
import { definitionsReadModelOf } from '../read-model/definitions-read-model.ts';
import { versionFromTheReadModel } from './read-model-versions.ts';

const types: readonly [string, ...string[]] = ['echo', 'workflow', 'lookup'];

async function aLedgerOf(seed: number): Promise<MemoryLedger> {
  const ledger = memoryLedger(undefined, [definitionsReadModelOf(types)]);
  await aGeneratedHistory(ledger.service, seed, types);
  return ledger;
}

describe('the saved versions in the read model of the current definitions, over generated histories', () => {
  it.each([1, 2, 3, 4, 5])('answer every saved version as the fold of its stream does, history %i', async (seed) => {
    const ledger = await aLedgerOf(seed);
    const versions = savedVersionsIn(await definitionsIn(ledger.service, types));

    const read = await Promise.all(
      versions.map(async ({ type, name, version }) => {
        const found = await inThePlaybook(ledger, versionFromTheReadModel(type, name, version));
        return [found.source, found.stripped, found.putInPlaceBy];
      }),
    );
    const folded = await Promise.all(
      versions.map((address) => Effect.runPromise(foldedVersionIn(ledger.service, address))),
    );

    expect(versions.length).toBeGreaterThan(5);
    expect(read).toEqual(folded);
  });
});
