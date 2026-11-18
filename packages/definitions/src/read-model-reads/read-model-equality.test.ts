import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { contributesIn } from '../contributions/contributes-details.ts';
import { listedWith } from '../operations/answered-definitions.ts';
import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import {
  aGeneratedHistory,
  aReader,
  definitionsIn,
  executedIn,
  foldedVersionIn,
  namesOf,
  registriesIn,
  savedVersionsIn,
  type TypedDefinition,
  warningsSavedWith,
} from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { usersOf } from '../used-by/definition-users.ts';
import { listedOfTheRow } from './read-model-answers.ts';
import { storedFromTheReadModel } from './read-model-stored.ts';
import { usersFromTheReadModel } from './read-model-users.ts';
import { versionFromTheReadModel } from './read-model-versions.ts';

const types: readonly [string, ...string[]] = ['echo', 'workflow', 'lookup'];

interface History {
  readonly seed: number;
  readonly goals: boolean;
}

const histories: readonly History[] = [1, 2, 3, 4, 5].flatMap((seed) => [
  { seed, goals: false },
  { seed, goals: true },
]);

const contributes = [{ goal: 'kept-going', purpose: 'Counts the runs that ended.', measures: '/ended', final: true }];

async function aLedgerOf(seed: number): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(types);
  await aGeneratedHistory(ledger.service, seed, types);
  await executedIn(ledger.service, 'workflow', {
    type: 'create',
    name: 'contributing',
    content: { source: '{}', details: { shape: 'table', contributes } },
    created_by: aReader,
    definition_id: 'id-of-contributing',
  });
  return ledger;
}

function isAContributingWorkflow({ type, registered }: TypedDefinition): boolean {
  return type === 'workflow' && contributesIn(registered.details) !== undefined;
}

async function aLedgerOfReadModelUsers(seed: number): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(types);
  await aGeneratedHistory(ledger.service, seed, types);
  return ledger;
}

async function aLedgerOfReadModelVersions(seed: number): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(types);
  await aGeneratedHistory(ledger.service, seed, types);
  return ledger;
}

describe('the read model of the current definitions, over histories generated from every command', () => {
  it.each(histories)(
    'answers every definition and its list entry as the registry does, history $seed, goals kept $goals',
    async ({ seed, goals }) => {
      const ledger = await aLedgerOf(seed);
      const definitions = await definitionsIn(ledger.service, types);

      const read = await Promise.all(
        definitions.map(async ({ type, registered }) => {
          const found = await inThePlaybook(ledger, storedFromTheReadModel(type, registered.name));
          return [found.stored, listedOfTheRow(echo, found.row, found.savedBy, goals)];
        }),
      );

      expect(definitions.length).toBeGreaterThan(3);
      expect(definitions.some((definition) => isAContributingWorkflow(definition))).toBe(true);
      expect(read).toEqual(
        definitions.map(({ registered }) => [
          registered,
          listedWith(echo, registered, warningsSavedWith(registered), goals),
        ]),
      );
    },
  );
});

describe('who uses each definition, in the read model of the current definitions, over generated histories', () => {
  it.each([1, 2, 3, 4, 5])('is answered as the registries answer it, history %i', async (seed) => {
    const ledger = await aLedgerOfReadModelUsers(seed);
    const registries = await Effect.runPromise(registriesIn(ledger.service, types));
    const used = namesOf(types);

    const read = await Promise.all(used.map((each) => inThePlaybook(ledger, usersFromTheReadModel(types, each))));

    expect(read.flat().length).toBeGreaterThan(0);
    expect(read).toEqual(used.map((each) => usersOf(registries, each)));
  });
});

describe('the saved versions in the read model of the current definitions, over generated histories', () => {
  it.each([1, 2, 3, 4, 5])('answer every saved version as the fold of its stream does, history %i', async (seed) => {
    const ledger = await aLedgerOfReadModelVersions(seed);
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
