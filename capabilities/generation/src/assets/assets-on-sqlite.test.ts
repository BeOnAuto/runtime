import { ledgerLayer } from '@on.auto/ledger/sqlite';
import type { KeyedProjection } from '@on.auto/operations';
import { describe } from 'vitest';

import { assetsOnStoresSuite, definitionsPlacedApart } from '../store-testing/assets-on-stores.ts';
import { waitingOnStoresSuite } from '../store-testing/waiting-on-stores.ts';

function onSQLite(projections: readonly KeyedProjection[]) {
  return Promise.resolve(ledgerLayer({ fileName: ':memory:', projections, definitionNames: definitionsPlacedApart }));
}

describe('the assets of playbooks on SQLite', () => {
  assetsOnStoresSuite(onSQLite);
});

describe('the generations playbooks wait for on SQLite', () => {
  waitingOnStoresSuite(onSQLite);
});
