import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, at, json, resultOf } from '../testing/content-samples.ts';
import { keptTextOf } from '../testing/kept-text.ts';
import { memoryContentHeads, memoryContentStore } from '../testing/memory-content.ts';
import { sha256Of } from './content-digest.ts';
import { keptOutside } from './kept-outside.ts';
import type { ContentStore } from './recorded-content.ts';
import { textToKeep } from './streamed-content.ts';

const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

const note = '{"note":"found where a read finds it"}';

const noteDigest = sha256Of(note);

function counted(store: ContentStore): { readonly store: ContentStore; readonly asked: () => number } {
  let asked = 0;
  return {
    store: {
      ...store,
      holds: (playbook, sha256) =>
        Effect.suspend(() => {
          asked += 1;
          return store.holds(playbook, sha256);
        }),
    },
    asked: () => asked,
  };
}

describe('a content kept outside the ledger, as it is found', () => {
  it('is found where its store holds its bytes, whatever head stands, as a read reads it, and is not found where the store holds none', async () => {
    const store = memoryContentStore();
    const outside = keptOutside(memoryContentHeads(), store);
    const staged = await resultOf(store.stage(alpha, textToKeep(note, json)));
    await resultOf(staged.placed(json));

    const headless = await resultOf(outside.found(alpha, noteDigest));
    const read = await keptTextOf(outside.content, alpha, noteDigest);
    const never = await resultOf(outside.found(alpha, sha256Of('{"note":"never kept"}')));

    expect([headless, read, never]).toEqual([true, note, false]);
  });

  it('is found where its bytes were erased on purpose, without asking its store, as a read answers nothing without asking it', async () => {
    const { store, asked } = counted(memoryContentStore());
    const outside = keptOutside(memoryContentHeads(), store);
    const expiresAt = keptAt + 1000;
    await at(keptAt, outside.content.put(alpha, { ...textToKeep(note, json), expiresAt }));
    await at(expiresAt, outside.eraseExpired(10));

    const before = asked();
    const found = await resultOf(outside.found(alpha, noteDigest));

    expect([found, asked() - before]).toEqual([true, 0]);
    expect(await keptTextOf(outside.content, alpha, noteDigest)).toBeUndefined();
  });
});
