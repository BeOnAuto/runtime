import { readFileSync } from 'node:fs';

import { statement } from '@on.auto/ledger';
import { ledgerLayout } from '@on.auto/ledger/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { readOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { loopbackSettingsOver } from '../testing/servers/reasoning-server.ts';

const CatalogRows = Schema.Array(Schema.Struct({ name: Schema.String, sql: Schema.String }));

const PinnedLayout = Schema.fromJsonString(Schema.Struct({ layout: Schema.Number, catalog: CatalogRows }));

const everyRelationButTheStores = statement`SELECT name, sql FROM sqlite_master
  WHERE type IN ('table', 'index') AND name NOT GLOB 'emt_*' AND name NOT GLOB 'dmb_*' AND name NOT GLOB 'sqlite_*'
  ORDER BY name`;

function pinned() {
  return Schema.decodeUnknownSync(PinnedLayout)(readFileSync(new URL('database-layout.json', import.meta.url), 'utf8'));
}

function onOneLine(sql: string): string {
  return sql.replaceAll(/\s+/gu, ' ').replaceAll('( ', '(').replaceAll(' )', ')');
}

async function catalogOfANewServer(): Promise<readonly { readonly name: string; readonly sql: string }[]> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const server = await startServer(loopbackSettingsOver(ledger), compositionRoot);
  await server.stop();
  const rows = Schema.decodeUnknownSync(CatalogRows)(
    await readOfTheLedgerIn(ledger.fileName, everyRelationButTheStores),
  );
  return rows.map(({ name, sql }) => ({ name, sql: onOneLine(sql) }));
}

describe('the layout of the database the server opens', () => {
  it('is the layout of every table and index the ledger, the workflow host and the folders of its projector make, pinned in database-layout.json under the number of the ledger', async () => {
    const catalog = await catalogOfANewServer();

    expect(
      { layout: ledgerLayout, catalog },
      "The layout of the server's database changed: raise ledgerLayout in packages/ledger/src/layout/ledger-layout.ts, then pin in src/database/database-layout.json the layout and the catalog of every table and index the server makes",
    ).toEqual(pinned());
  });
});
