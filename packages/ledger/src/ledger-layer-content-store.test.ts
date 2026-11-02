import { textToKeep } from '@on.auto/content';
import { at, memoryContentStore } from '@on.auto/content/testing';
import { keptContentGraceMs } from '@on.auto/operations';
import { noteHolders } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayer } from './sqlite3.ts';
import { openChoresWith } from './testing/open-ledger.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

describe('a ledger given a content store of its own', () => {
  it('keeps its content there, reads it back from there, and sweeps that store when its chore is called', async () => {
    const store = memoryContentStore();
    const swept = Promise.withResolvers<number>();
    const { ledger, sweptAt, dispose } = await openChoresWith(
      ledgerLayer({
        fileName: ':memory:',
        content: {
          ...store,
          sweepContent: (before) => {
            swept.resolve(before);
            return Promise.resolve();
          },
        },
      }),
    );
    onTestFinished(dispose);

    const kept = await Effect.runPromise(ledger.content.put(alpha, textToKeep('{}', 'application/json')));
    const held = await Effect.runPromise(store.read(alpha, kept.sha256));

    expect(held).toMatchObject({ bytes: 2, mediaType: 'application/json' });
    expect(await Effect.runPromise(ledger.content.get(alpha, kept.sha256))).toMatchObject({ bytes: 2 });
    await sweptAt(Date.now());
    expect(await swept.promise).toBeLessThan(Date.now());
  });

  it('removes from that store a content nothing holds, once the hour after it was kept has passed', async () => {
    const store = memoryContentStore();
    const { ledger, dispose } = await openChoresWith(
      ledgerLayer({ fileName: ':memory:', holders: noteHolders, content: store }),
    );
    onTestFinished(dispose);
    const keptAt = Date.parse('2026-11-01T09:00:00.000Z');
    const { sha256 } = await at(keptAt, ledger.content.put(alpha, textToKeep('{}', 'application/json')));

    const removed = await at(keptAt + keptContentGraceMs + 1, ledger.removeUnheld(alpha, sha256));

    expect(removed).toBe('removed');
    expect(await Effect.runPromise(store.read(alpha, sha256))).toBeUndefined();
  });
});
