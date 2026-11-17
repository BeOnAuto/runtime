import { sha256Of } from '@on.auto/content';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PlaybookContext } from '../caller/playbook-context.ts';
import { textBytesOf, textPayloadText } from '../payloads/payload-texts.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { notebook } from '../testing/notes.ts';
import { playbookLedgerOf } from './playbook-ledger.ts';
import { PlaybookReader } from './playbook-reader.ts';
import { playbookPayloadKept, PlaybookWriter } from './playbook-writer.ts';

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

const alpha = { org: 'acme', playbook: 'alpha' };

const gamma = { org: 'globex', playbook: 'gamma' };

const text = 'n'.repeat(3000);

const toKeep = { ...textPayloadText(text), sha256: sha256Of(text), bytes: textBytesOf(text) };

describe('the keeper of the payloads of the playbook of a call', () => {
  it('keeps a payload in the content of that playbook alone, before a fact names it', async () => {
    const { service } = memoryLedger();
    await Effect.runPromise(
      playbookPayloadKept(toKeep).pipe(
        Effect.provideContext(playbookLedgerOf(service, alpha)),
        Effect.provideService(PlaybookContext, alpha),
      ),
    );
    const heads = Effect.all([
      service.content.getHead(alpha, toKeep.sha256),
      service.content.getHead(gamma, toKeep.sha256),
    ]);

    expect(await Effect.runPromise(heads)).toMatchObject([
      { bytes: 3000, mediaType: 'text/plain; charset=utf-8' },
      undefined,
    ]);
  });
});
