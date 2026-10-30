import { readFileSync } from 'node:fs';

import { ledgerLayout } from '@on.auto/ledger/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { catalogOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { loopbackSettingsOver } from '../testing/servers/reasoning-server.ts';

const PinnedLayout = Schema.fromJsonString(
  Schema.Struct({
    layout: Schema.Number,
    catalog: Schema.Array(Schema.Struct({ name: Schema.String, sql: Schema.String })),
  }),
);

function pinned() {
  return Schema.decodeUnknownSync(PinnedLayout)(readFileSync(new URL('database-layout.json', import.meta.url), 'utf8'));
}

describe('the layout of the database the server opens', () => {
  it('is the layout of every table and index the ledger, the workflow host and the folders of its projector make, pinned in database-layout.json under the number of the ledger', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const server = await startServer(loopbackSettingsOver(ledger), compositionRoot);
    await server.stop();

    const catalog = await catalogOfTheLedgerIn(ledger.fileName);

    expect(
      { layout: ledgerLayout, catalog },
      "The layout of the server's database changed: raise ledgerLayout in packages/ledger/src/layout/ledger-layout.ts, register the step that leads to it with the package that owns the table, then pin in src/database/database-layout.json the layout and the catalog of every table and index the server makes",
    ).toEqual(pinned());
  });
});
