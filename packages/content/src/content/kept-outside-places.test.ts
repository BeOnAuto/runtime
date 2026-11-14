import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, at, json, present, readThrough, resultOf } from '../testing/content-samples.ts';
import { keptTextOf } from '../testing/kept-text.ts';
import { memoryContentHeads, memoryContentStore } from '../testing/memory-content.ts';
import { sha256Of } from './content-digest.ts';
import { keptOutside } from './kept-outside.ts';
import type { ContentHeads, ContentStore } from './recorded-content.ts';
import { textToKeep } from './streamed-content.ts';

const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

const anHour = 3_600_000;

const note = '{"note":"kept at two places"}';

const noteDigest = sha256Of(note);

const earlierPlace = 'an earlier place/';

interface TwoPlaces {
  readonly store: ContentStore;
  readonly heads: ContentHeads;
  readonly places: readonly string[];
  readonly recorded: readonly string[];
}

function twoPlaces(): TwoPlaces {
  const heads = memoryContentHeads();
  const recorded: string[] = [];
  return {
    store: memoryContentStore(),
    heads: {
      ...heads,
      placesOf: (playbook, sha256) =>
        Effect.map(heads.placesOf(playbook, sha256), (places) => [earlierPlace, ...places]),
      placed: (playbook, sha256, place) =>
        Effect.andThen(
          Effect.sync(() => recorded.push(place)),
          heads.placed(playbook, sha256, place),
        ),
    },
    places: [earlierPlace, heads.placeOfNewBytes(alpha)],
    recorded,
  };
}

function heldAtEach({ store, places }: TwoPlaces): Promise<readonly boolean[]> {
  return Promise.all(places.map((place) => resultOf(store.holds(place, noteDigest))));
}

async function placedEarlier({ store }: TwoPlaces): Promise<void> {
  const staged = await resultOf(store.stage(earlierPlace, textToKeep(note, json)));
  await resultOf(staged.placed(json));
}

function readAtTheFirstThatHolds(): void {
  it('reads it, whole and in part, and finds it, at the first of its places that holds it', async () => {
    const placing = twoPlaces();
    const outside = keptOutside(placing.heads, placing.store);
    await placedEarlier(placing);

    const whole = await keptTextOf(outside.content, alpha, noteDigest);
    const { part } = await present(outside.content.getPart(alpha, noteDigest, { start: 2, end: undefined }));
    const read = await readThrough((await present(Effect.succeed(part))).stream);
    const found = await resultOf(outside.found(alpha, noteDigest));

    expect([whole, read.bytes, found]).toEqual([note, note.length - 2, true]);
  });
}

function placedWhereNewBytesGo(): void {
  it('places the bytes of a put at the place its heads give new bytes, records that place first, and places nothing where a place it names holds them', async () => {
    const placing = twoPlaces();
    const outside = keptOutside(placing.heads, placing.store);
    const newPlace = placing.heads.placeOfNewBytes(alpha);

    await at(keptAt, outside.content.put(alpha, textToKeep(note, json)));
    const placedNew = [...(await heldAtEach(placing)), [...placing.recorded]];
    await resultOf(placing.store.delete(newPlace, noteDigest));
    await placedEarlier(placing);
    await at(keptAt + 1, outside.content.put(alpha, textToKeep(note, json)));

    expect([...placedNew, ...(await heldAtEach(placing))]).toEqual([false, true, [newPlace], true, false]);
  });
}

function removedAtEveryPlace(): void {
  it('deletes the bytes at every place as it removes the content, so no read finds it', async () => {
    const placing = twoPlaces();
    const outside = keptOutside(placing.heads, placing.store);
    await at(keptAt, outside.content.put(alpha, textToKeep(note, json)));
    await placedEarlier(placing);

    const removed = await at(keptAt + 2 * anHour, outside.removedKeptBefore(alpha, noteDigest, keptAt + anHour));

    expect([removed, ...(await heldAtEach(placing))]).toEqual(['removed', false, false]);
    expect(await resultOf(outside.content.get(alpha, noteDigest))).toBeUndefined();
  });
}

function erasedAtEveryPlace(): void {
  it('deletes the bytes at every place as it erases the content past its expiry', async () => {
    const placing = twoPlaces();
    const outside = keptOutside(placing.heads, placing.store);
    await at(keptAt, outside.content.put(alpha, { ...textToKeep(note, json), expiresAt: keptAt + anHour }));
    await placedEarlier(placing);

    const erased = await at(keptAt + 2 * anHour, outside.eraseExpired(10));

    expect([erased, ...(await heldAtEach(placing))]).toEqual([{ erased: 1, more: false }, false, false]);
  });
}

describe('a content kept outside the ledger whose heads name several places', () => {
  readAtTheFirstThatHolds();
  placedWhereNewBytesGo();
  removedAtEveryPlace();
  erasedAtEveryPlace();
});
