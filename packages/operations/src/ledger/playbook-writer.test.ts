import { sha256Of } from '@on.auto/content';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PlaybookContext } from '../caller/playbook-context.ts';
import { textBytesOf, textPayloadText } from '../payloads/payload-texts.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { playbookLedgerOf } from './playbook-ledger.ts';
import { playbookPayloadKept } from './playbook-writer.ts';

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
