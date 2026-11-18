import type { KeyedProjection, Ledger } from '@on.auto/operations';
import type { DefinitionNames } from '@on.auto/operations/definition-names';
import {
  addressesOfRows,
  definitionRowsBehaviour,
  definitionsPlaced,
  placedIn,
  ran,
  runTallyRows,
  topicFacts,
  topicsAtTheOrg,
  type NamingLedger,
  type TopicFact,
} from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { LedgerStore } from '../event-store.ts';
import { makeLedger } from '../ledger-service.ts';

export interface NamingStores {
  readonly aDatabase: () => Promise<string>;
  readonly storeOn: (database: string, projections: readonly KeyedProjection[], names: DefinitionNames) => LedgerStore;
}

async function openedOn(store: LedgerStore): Promise<Ledger['Service']> {
  onTestFinished(() => store.close());
  await store.migrate();
  return makeLedger(store);
}

function namingLedgerOn({ aDatabase, storeOn }: NamingStores): NamingLedger {
  return async (projections, names) => openedOn(storeOn(await aDatabase(), projections, names));
}

const alpha = { org: 'acme', playbook: 'alpha' };

function definitionFillsBehaviour({ aDatabase, storeOn }: NamingStores): void {
  describe('a projection of the streams filed under the key of a definition, filled as the ledger opens', () => {
    it('folds the facts the store holds of the definitions a playbook holds into the rows read for that playbook', async () => {
      const database = await aDatabase();
      const before = storeOn(database, [], definitionsPlaced);
      await before.migrate();
      const recording = makeLedger(before);
      await placedIn(recording, 'd1', 'alpha');
      await ran(recording, 'definition/acme/d1/runs/r1');
      await ran(recording, 'playbook/acme/alpha/runs/r0');
      await before.close();

      const ledger = await openedOn(
        storeOn(database, [{ ...runTallyRows, scopes: ['playbook', 'definition'] }], definitionsPlaced),
      );

      expect(await addressesOfRows(ledger, 'run_tallies', alpha)).toEqual([
        { org: 'acme', playbook: 'alpha', definition: undefined, key: 'r0' },
        { org: 'acme', playbook: 'alpha', definition: 'd1', key: 'r1' },
      ]);
    });
  });
}

function orgRowsFillsBehaviour({ aDatabase, storeOn }: NamingStores): void {
  describe('a projection that keeps its rows at the org of the streams it folds, filled as the ledger opens', () => {
    it('folds the streams of every definition of an org into the row at the org that keeping them as appended gives', async () => {
      const database = await aDatabase();
      const before = storeOn(database, [topicsAtTheOrg], definitionsPlaced);
      await before.migrate();
      const recording = makeLedger(before);
      await placedIn(recording, 'd1', 'alpha');
      await topicsIn(recording, 'definition/acme/d1/runs/r1', {
        type: 'topic_opened',
        data: { topic: 'spring', at: 0 },
      });
      await topicsIn(recording, 'definition/acme/d2/notes/n1', {
        type: 'topic_noted',
        data: { topic: 'spring', note: 'd2' },
      });
      await topicsIn(recording, 'definition/umbrella/d3/runs/r3', {
        type: 'topic_opened',
        data: { topic: 'spring', at: 0 },
      });
      const kept = await rowsAtTheOrgs(recording);
      await before.close();

      const ledger = await openedOn(storeOn(database, [{ ...topicsAtTheOrg, version: 3 }], definitionsPlaced));

      expect(await rowsAtTheOrgs(ledger)).toEqual(kept);
      expect(kept.map(({ org, key, row }) => [org, key, row['note']])).toEqual([
        ['acme', 'spring', 'd2'],
        ['umbrella', 'spring', null],
      ]);
    });
  });
}

function topicsIn(ledger: Ledger['Service'], stream: string, fact: TopicFact): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, topicFacts, [fact]));
}

async function rowsAtTheOrgs(ledger: Ledger['Service']) {
  const everyRow = { where: [], orderBy: [], order: 'asc', limit: 10 } as const;
  const orgs = await Promise.all(
    ['acme', 'umbrella'].map((org) => Effect.runPromise(ledger.readProjectedRows('topics', { org }, everyRow))),
  );
  return orgs.flat();
}

export function definitionProjectionsOnStoresBehaviour(stores: NamingStores): void {
  definitionRowsBehaviour(namingLedgerOn(stores));
  definitionFillsBehaviour(stores);
  orgRowsFillsBehaviour(stores);
}
