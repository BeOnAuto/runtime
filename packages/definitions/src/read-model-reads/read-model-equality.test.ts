import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { listedWith } from '../operations/answered-definitions.ts';
import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aGeneratedHistory, definitionsIn, warningsSavedWith } from '../read-model-testing/read-model-histories.ts';
import { definitionsReadModelOf } from '../read-model/definitions-read-model.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { listedOfTheRow } from './read-model-answers.ts';
import { storedFromTheReadModel } from './read-model-stored.ts';

const types: readonly [string, ...string[]] = ['echo', 'workflow', 'lookup'];

async function aLedgerOf(seed: number): Promise<MemoryLedger> {
  const ledger = memoryLedger(undefined, [definitionsReadModelOf(types)]);
  await aGeneratedHistory(ledger.service, seed, types);
  return ledger;
}

describe('the read model of the current definitions, over histories generated from every command', () => {
  it.each([1, 2, 3, 4, 5])(
    'answers every definition and its list entry as the registry does, history %i',
    async (seed) => {
      const ledger = await aLedgerOf(seed);
      const definitions = await definitionsIn(ledger.service, types);

      const read = await Promise.all(
        definitions.map(async ({ type, registered }) => {
          const found = await inThePlaybook(ledger, storedFromTheReadModel(type, registered.name));
          return [found.stored, listedOfTheRow(echo, found.row, found.savedBy)];
        }),
      );

      expect(definitions.length).toBeGreaterThan(3);
      expect(read).toEqual(
        definitions.map(({ registered }) => [registered, listedWith(echo, registered, warningsSavedWith(registered))]),
      );
    },
  );
});
