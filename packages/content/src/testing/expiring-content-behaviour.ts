import { describe, expect, it } from 'vitest';

import type { ContentToKeep } from '../content/streamed-content.ts';
import type { ExpiringContentEntry } from './content-entry.ts';
import { alpha, at, beta, generated, json, octets, present, readBack, resultOf } from './content-samples.ts';
import {
  aDay,
  byItsDigest,
  expiringAt,
  headOf,
  heldUntil,
  keptAt,
  keptHead,
  oneChunk,
  severalChunks,
  whole,
} from './expiring-samples.ts';
import { defectOf } from './paused-store.ts';

function laterExpiryKept(entry: ExpiringContentEntry): void {
  it.each([
    ['of one chunk, whole', oneChunk, whole],
    ['of several chunks, whole', severalChunks, whole],
    ['of several chunks, by its digest', severalChunks, byItsDigest],
    ['of one chunk, by its digest', oneChunk, byItsDigest],
  ])(
    'keeps the expiry a put gives a content, the later of two once it is put again %s, and none for good once a put gives none',
    async (_how, bytes, way) => {
      const store = await entry.aStore();
      const content = await generated(bytes);
      const putAt = async (moment: number, put: ContentToKeep) => {
        const kept = await at(moment, store.content.put(alpha, put));
        return [kept, (await headOf(store, alpha, content.sha256))?.expiresAt];
      };

      const puts = [
        await putAt(keptAt, expiringAt(whole(content), keptAt + aDay)),
        await putAt(keptAt + 1, expiringAt(way(content), keptAt + 3 * aDay)),
        await putAt(keptAt + 2, expiringAt(way(content), keptAt + 2 * aDay)),
        await putAt(keptAt + 3, way(content)),
        await putAt(keptAt + 4, expiringAt(way(content), keptAt + 4 * aDay)),
      ];

      const kept = { sha256: content.sha256, bytes, mediaType: octets };
      expect(puts).toEqual([
        [kept, keptAt + aDay],
        [kept, keptAt + 3 * aDay],
        [kept, keptAt + 3 * aDay],
        [kept, undefined],
        [kept, undefined],
      ]);
      expect(await at(keptAt + 10 * aDay, store.eraseExpired(10))).toEqual({ erased: 0, more: false });
      expect(await store.bytesHeld(alpha, content.sha256)).toBe(true);
    },
  );
}

function keptForGoodWhateverTheOrder(entry: ExpiringContentEntry): void {
  it.each([
    ['before, whole,', whole, undefined, keptAt + aDay],
    ['before, by its digest,', byItsDigest, undefined, keptAt + aDay],
    ['after, whole,', whole, keptAt + aDay, undefined],
    ['after, by its digest,', byItsDigest, keptAt + aDay, undefined],
  ])(
    'erases nothing of a content a put kept for good %s the put that gave it an expiry, so an expiry never takes what was kept for good',
    async (_how, way, first, second) => {
      const store = await entry.aStore();
      const content = await generated(severalChunks);
      await at(keptAt, store.content.put(alpha, expiringAt(whole(content), first)));
      await at(keptAt + 1, store.content.put(alpha, expiringAt(way(content), second)));

      const erased = await at(keptAt + 10 * aDay, store.eraseExpired(10));

      expect(erased).toEqual({ erased: 0, more: false });
      expect(await headOf(store, alpha, content.sha256)).toEqual({
        bytes: severalChunks,
        mediaType: octets,
        keptAt: keptAt + 1,
      });
      expect(await readBack(await present(store.content.get(alpha, content.sha256)))).toMatchObject({
        sha256: content.sha256,
        bytes: severalChunks,
      });
    },
  );
}

function erasedOnceDue(entry: ExpiringContentEntry): void {
  it('erases the bytes of a content once its expiry has passed, leaves its head saying when, reads nothing of it whole or in part, here or elsewhere, and leaves whole a content kept for good and one not yet due', async () => {
    const store = await entry.aStore();
    const [expiring, forGood, notYet] = [
      await generated(severalChunks),
      await generated(oneChunk, 11),
      await generated(oneChunk, 13),
    ];
    await at(keptAt, store.content.put(alpha, expiringAt(expiring.content(), keptAt + aDay)));
    await at(keptAt, store.content.put(alpha, forGood.content()));
    await at(keptAt, store.content.put(alpha, expiringAt(notYet.content(), keptAt + 2 * aDay)));

    const erased = await at(keptAt + aDay, store.eraseExpired(10));

    expect(erased).toEqual({ erased: 1, more: false });
    expect(await headOf(store, alpha, expiring.sha256)).toEqual({
      bytes: severalChunks,
      mediaType: octets,
      keptAt,
      erasedAt: keptAt + aDay,
    });
    expect([
      await resultOf(store.content.get(alpha, expiring.sha256)),
      await resultOf(store.content.getPart(alpha, expiring.sha256, { start: 0, end: 9 })),
      await resultOf(store.elsewhere.content.get(alpha, expiring.sha256)),
      await store.bytesHeld(alpha, expiring.sha256),
    ]).toEqual([undefined, undefined, undefined, false]);
    expect(await readBack(await present(store.content.get(alpha, forGood.sha256)))).toMatchObject({
      sha256: forGood.sha256,
    });
    expect(await readBack(await present(store.content.get(alpha, notYet.sha256)))).toMatchObject({
      sha256: notYet.sha256,
    });
    expect((await headOf(store, alpha, notYet.sha256))?.expiresAt).toBe(keptAt + 2 * aDay);
  });
}

function keptAgainAfterErasure(entry: ExpiringContentEntry): void {
  it.each([
    ['of one chunk, whole, for good', oneChunk, whole, undefined],
    ['of several chunks, whole, with a later expiry', severalChunks, whole, keptAt + 3 * aDay],
    ['of several chunks, by its digest, for good', severalChunks, byItsDigest, undefined],
    ['of one chunk, by its digest, with a later expiry', oneChunk, byItsDigest, keptAt + 3 * aDay],
  ])(
    'keeps a content put again %s after its bytes were erased, writing its bytes again with the media type and the expiry of that put',
    async (_how, bytes, way, expiresAt) => {
      const store = await entry.aStore();
      const content = await generated(bytes);
      await at(keptAt, store.content.put(alpha, expiringAt(content.content(), keptAt + aDay)));
      await at(keptAt + aDay, store.eraseExpired(10));

      const kept = await at(
        keptAt + 2 * aDay,
        store.content.put(alpha, expiringAt({ ...way(content), mediaType: json }, expiresAt)),
      );
      const erasedAgain = await at(keptAt + 2 * aDay + 1, store.eraseExpired(10));

      expect([kept, erasedAgain]).toEqual([
        { sha256: content.sha256, bytes, mediaType: json },
        { erased: 0, more: false },
      ]);
      expect(await headOf(store, alpha, content.sha256)).toEqual(
        keptHead({ bytes, mediaType: json, keptAt: keptAt + 2 * aDay }, expiresAt),
      );
      expect(await readBack(await present(store.content.get(alpha, content.sha256)))).toMatchObject({
        sha256: content.sha256,
        bytes,
        mediaType: json,
      });
      expect(await store.bytesHeld(alpha, content.sha256)).toBe(true);
    },
  );
}

function keptForGoodWhilePutAtOnce(entry: ExpiringContentEntry): void {
  it.each([
    ['the put for good held', undefined, keptAt + 3 * aDay],
    ['the put with an expiry held', keptAt + 3 * aDay, undefined],
  ])(
    'keeps for good a content erased and put again at once, for good and with an expiry, %s until the other put kept it',
    async (_how, held, other) => {
      const store = await entry.aStore();
      const content = await generated(severalChunks);
      await at(keptAt, store.content.put(alpha, expiringAt(content.content(), keptAt + aDay)));
      await at(keptAt + aDay, store.eraseExpired(10));
      const released = Promise.withResolvers<void>();

      const first = at(
        keptAt + 2 * aDay,
        store.content.put(alpha, expiringAt(heldUntil(content.content(), released.promise), held)),
      );
      await at(keptAt + 2 * aDay + 1, store.elsewhere.content.put(alpha, expiringAt(content.content(), other)));
      released.resolve();
      await first;

      expect((await headOf(store, alpha, content.sha256))?.expiresAt).toBeUndefined();
      expect(await at(keptAt + 10 * aDay, store.eraseExpired(10))).toEqual({ erased: 0, more: false });
      expect(await readBack(await present(store.content.get(alpha, content.sha256)))).toMatchObject({
        sha256: content.sha256,
        bytes: severalChunks,
      });
    },
  );
}

function erasedInBatches(entry: ExpiringContentEntry): void {
  it('erases at most as many contents as it is asked, the soonest due first, across the playbooks, each at its expiry and once, saying whether more may be due', async () => {
    const store = await entry.aStore();
    const [first, second, third, later] = [
      await generated(oneChunk, 21),
      await generated(oneChunk, 23),
      await generated(oneChunk, 25),
      await generated(oneChunk, 27),
    ];
    await at(keptAt, store.content.put(alpha, expiringAt(third.content(), keptAt + 3)));
    await at(keptAt, store.content.put(beta, expiringAt(second.content(), keptAt + 2)));
    await at(keptAt, store.content.put(alpha, expiringAt(first.content(), keptAt + 1)));
    await at(keptAt, store.content.put(alpha, expiringAt(later.content(), keptAt + 2 * aDay)));

    const passes = [
      await at(keptAt, store.eraseExpired(10)),
      await at(keptAt + 1, store.eraseExpired(10)),
      await at(keptAt + aDay, store.eraseExpired(1)),
      await at(keptAt + aDay, store.eraseExpired(1)),
      await at(keptAt + aDay, store.eraseExpired(1)),
    ];
    const erasedAt = [
      (await headOf(store, alpha, first.sha256))?.erasedAt,
      (await headOf(store, beta, second.sha256))?.erasedAt,
      (await headOf(store, alpha, third.sha256))?.erasedAt,
      (await headOf(store, alpha, later.sha256))?.erasedAt,
    ];

    expect(passes).toEqual([
      { erased: 0, more: false },
      { erased: 1, more: false },
      { erased: 1, more: true },
      { erased: 1, more: true },
      { erased: 0, more: false },
    ]);
    expect(erasedAt).toEqual([keptAt + 1, keptAt + aDay, keptAt + aDay, undefined]);
  });
}

function erasedOnceByTwoAtOnce(entry: ExpiringContentEntry): void {
  it('erases each content once where two erasures of the store run at once, and both end', async () => {
    const store = await entry.aStore();
    const contents = await Promise.all([31, 33, 35, 37, 39, 41].map((seed) => generated(oneChunk, seed)));
    await Promise.all(
      contents.map((content) => at(keptAt, store.content.put(alpha, expiringAt(content.content(), keptAt + 1)))),
    );

    const [here, elsewhere] = await Promise.all([
      at(keptAt + aDay, store.eraseExpired(10)),
      at(keptAt + aDay, store.elsewhere.eraseExpired(10)),
    ]);
    const held = await Promise.all(contents.map(({ sha256 }) => store.bytesHeld(alpha, sha256)));

    expect([here.erased + elsewhere.erased, here.more, elsewhere.more]).toEqual([6, false, false]);
    expect(held).toEqual(contents.map(() => false));
  });
}

function refusedAsDefects(entry: ExpiringContentEntry): void {
  it('fails as a defect a put whose expiry is no whole number of milliseconds, keeping nothing of it, and an erasure asked for no head', async () => {
    const store = await entry.aStore();
    const content = await generated(oneChunk);

    const failed = [
      await resultOf(defectOf(store.content.put(alpha, expiringAt(content.content(), keptAt + 0.5)))),
      await at(keptAt, defectOf(store.eraseExpired(0))),
    ];

    expect(failed).toEqual([
      new RangeError(`A content to keep expires at ${keptAt + 0.5}, which is no whole number of milliseconds`),
      new RangeError('An erasure of expired content was asked for 0 heads, where it takes one or more'),
    ]);
    expect(await headOf(store, alpha, content.sha256)).toBeUndefined();
    expect(await store.bytesHeld(alpha, content.sha256)).toBe(false);
  });
}

export function expiringContentBehaviour(entry: ExpiringContentEntry): void {
  describe('the content a playbook kept until it expires, erased once its expiry has passed', () => {
    laterExpiryKept(entry);
    keptForGoodWhateverTheOrder(entry);
    erasedOnceDue(entry);
    keptAgainAfterErasure(entry);
    keptForGoodWhilePutAtOnce(entry);
    erasedInBatches(entry);
    erasedOnceByTwoAtOnce(entry);
    refusedAsDefects(entry);
  });
}
