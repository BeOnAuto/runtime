import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { alpha, at, json } from '../testing/content-samples.ts';
import { keptTextOf } from '../testing/kept-text.ts';
import { memoryContentHeads, memoryContentStore } from '../testing/memory-content.ts';
import { erasureDeletesWithinMs, keptOutside } from './kept-outside.ts';
import type { ContentHeads } from './recorded-content.ts';
import { textToKeep } from './streamed-content.ts';

const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

const markedAt = keptAt + 86_400_000;

const note = '{"note":"kept outside, until it expires"}';

describe('an erasure of a content kept outside the ledger that pauses between its mark and its delete', () => {
  it('deletes nothing and lets go of its mark where it comes to delete once its mark is half the time a removal takes old, so the content stays whole and due, and the erasure after it erases it', async () => {
    const heads = memoryContentHeads();
    const pausing: ContentHeads = {
      ...heads,
      erasing: (playbook, sha256, times) =>
        Effect.tap(heads.erasing(playbook, sha256, times), () => TestClock.adjust(erasureDeletesWithinMs)),
    };
    const store = memoryContentStore();
    const kept = keptOutside(heads, store);
    const { sha256 } = await at(keptAt, kept.content.put(alpha, { ...textToKeep(note, json), expiresAt: markedAt }));

    const late = await at(markedAt, keptOutside(pausing, store).eraseExpired(10));
    const whole = await keptTextOf(kept.content, alpha, sha256);
    const after = await at(markedAt + 1, kept.eraseExpired(10));

    expect([late, whole, after]).toEqual([{ erased: 0, more: false }, note, { erased: 1, more: false }]);
    expect(await keptTextOf(kept.content, alpha, sha256)).toBeUndefined();
  });
});
