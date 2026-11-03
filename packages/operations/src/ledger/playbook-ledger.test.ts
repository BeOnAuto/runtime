import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryLedger } from '../testing/memory-ledger.ts';
import { notebook } from '../testing/notes.ts';
import { playbookLedgerOf } from './playbook-ledger.ts';
import { PlaybookReader } from './playbook-reader.ts';
import { PlaybookWriter } from './playbook-writer.ts';

describe('the ledger of one playbook, for code that holds the whole ledger', () => {
  it("reads and writes that playbook's streams alone", async () => {
    const ledger = memoryLedger();
    const inAlpha = playbookLedgerOf(ledger.service, { org: 'acme', playbook: 'alpha' });
    const inGamma = playbookLedgerOf(ledger.service, { org: 'globex', playbook: 'gamma' });
    const noted = PlaybookWriter.use((writer) => writer.execute('notes', notebook, { name: 'anvil', text: 'heavy' }));
    const read = PlaybookReader.use((reader) => reader.load('notes', notebook));

    await Effect.runPromise(Effect.provideContext(noted, inAlpha));

    expect(ledger.streamNames()).toEqual(['playbook/acme/alpha/notes']);
    expect(await Effect.runPromise(Effect.provideContext(read, inAlpha))).toMatchObject({
      state: [{ name: 'anvil', text: 'heavy' }],
    });
    expect(await Effect.runPromise(Effect.provideContext(read, inGamma))).toMatchObject({ state: [] });
  });
});
