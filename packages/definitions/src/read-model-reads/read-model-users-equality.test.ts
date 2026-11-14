import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aGeneratedHistory, namesOf, registriesIn } from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import { usersOf } from '../used-by/definition-users.ts';
import { usersFromTheReadModel } from './read-model-users.ts';

const types: readonly [string, ...string[]] = ['echo', 'workflow', 'lookup'];

async function aLedgerOf(seed: number): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(types);
  await aGeneratedHistory(ledger.service, seed, types);
  return ledger;
}

describe('who uses each definition, in the read model of the current definitions, over generated histories', () => {
  it.each([1, 2, 3, 4, 5])('is answered as the registries answer it, history %i', async (seed) => {
    const ledger = await aLedgerOf(seed);
    const registries = await Effect.runPromise(registriesIn(ledger.service, 'playbook/acme/alpha/', types));
    const used = namesOf(types);

    const read = await Promise.all(used.map((each) => inThePlaybook(ledger, usersFromTheReadModel(types, each))));

    expect(read.flat().length).toBeGreaterThan(0);
    expect(read).toEqual(used.map((each) => usersOf(registries, each)));
  });
});
