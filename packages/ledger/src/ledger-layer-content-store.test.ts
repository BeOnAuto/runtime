import { textToKeep } from '@on.auto/content';
import { memoryRecordedContent } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayer } from './sqlite3.ts';
import { openChoresWith } from './testing/open-ledger.ts';

describe('a ledger given a content store of its own', () => {
  it('keeps its content there, reads it back from there, and sweeps that store when its chore is called', async () => {
    const content = memoryRecordedContent();
    const swept = Promise.withResolvers<number>();
    const { ledger, sweptAt, dispose } = await openChoresWith(
      ledgerLayer({
        fileName: ':memory:',
        content: {
          content,
          sweepContent: (before) => {
            swept.resolve(before);
            return Promise.resolve();
          },
        },
      }),
    );
    onTestFinished(dispose);
    const alpha = { org: 'acme', playbook: 'alpha' };

    const kept = await Effect.runPromise(ledger.content.put(alpha, textToKeep('{}', 'application/json')));
    const held = await Effect.runPromise(content.get(alpha, kept.sha256));

    expect(held).toMatchObject({ bytes: 2, mediaType: 'application/json' });
    expect(await Effect.runPromise(ledger.content.get(alpha, kept.sha256))).toMatchObject({ bytes: 2 });
    await sweptAt(Date.now());
    expect(await swept.promise).toBeLessThan(Date.now());
  });
});
