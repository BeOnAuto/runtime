import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it, vi } from 'vitest';

import { erasureDeletesWithinMs, removalLastsMs } from '../content/kept-outside.ts';
import { textToKeep } from '../content/streamed-content.ts';
import type { InterleavedErasureEntry } from './content-entry.ts';
import { alpha, at, generated, json, octets, present, readBack, resultOf } from './content-samples.ts';
import { aDay, byItsDigest, expiringAt, headOf, keptAt, oneChunk, severalChunks, whole } from './expiring-samples.ts';
import { aStepFailedAtItsPause, defectOf, pausableStore, settledWithin, type PausedStep } from './paused-store.ts';

const note = '{"note":"kept outside, until it expires"}';

async function erasingOn(entry: InterleavedErasureEntry) {
  const paused = pausableStore(await entry.aStore());
  return { paused, keeping: await entry.aKeeping(paused.store) };
}

async function keptUntil(entry: InterleavedErasureEntry, expiresAt: number) {
  const { paused, keeping } = await erasingOn(entry);
  const { sha256 } = await at(keptAt, keeping.content.put(alpha, { ...textToKeep(note, json), expiresAt }));
  return { paused, keeping, sha256 };
}

function putWhileErased(entry: InterleavedErasureEntry): void {
  it.each([
    ['whole', whole],
    ['by its digest', byItsDigest],
  ])(
    'waits, put %s while an erasure deletes its bytes, until the erasure is recorded, then keeps the bytes whole again',
    async (_how, way) => {
      const { paused, keeping } = await erasingOn(entry);
      const content = await generated(severalChunks);
      await at(keptAt, keeping.content.put(alpha, expiringAt(content.content(), keptAt + aDay)));
      const deleting = paused.pausedDelete();

      const erasure = resultOf(keeping.eraseExpired(10));
      await deleting.reached;
      const put = resultOf(keeping.content.put(alpha, way(content)));
      const settledBefore = await settledWithin(put, 300);
      deleting.release();

      expect([settledBefore, await erasure, await put]).toEqual([
        false,
        { erased: 1, more: false },
        { sha256: content.sha256, bytes: severalChunks, mediaType: octets },
      ]);
      expect(await readBack(await present(keeping.content.get(alpha, content.sha256)))).toMatchObject({
        sha256: content.sha256,
        bytes: severalChunks,
      });
      expect(await headOf(keeping, alpha, content.sha256)).not.toHaveProperty('erasedAt');
    },
  );
}

function keptForGoodWhileErasing(entry: InterleavedErasureEntry): void {
  it('leaves whole a content a put kept for good while the erasure that read it as due was erasing another', async () => {
    const { paused, keeping } = await erasingOn(entry);
    const [erased, keptForGood] = [await generated(oneChunk, 43), await generated(oneChunk, 45)];
    await at(keptAt, keeping.content.put(alpha, expiringAt(erased.content(), keptAt + 1)));
    await at(keptAt, keeping.content.put(alpha, expiringAt(keptForGood.content(), keptAt + 2)));
    const deleting = paused.pausedDelete();

    const erasure = resultOf(keeping.eraseExpired(10));
    await deleting.reached;
    await resultOf(keeping.content.put(alpha, keptForGood.content()));
    deleting.release();

    expect(await erasure).toEqual({ erased: 1, more: false });
    expect((await headOf(keeping, alpha, erased.sha256))?.erasedAt).toEqual(expect.any(Number));
    expect(await headOf(keeping, alpha, keptForGood.sha256)).not.toHaveProperty('expiresAt');
    expect(await readBack(await present(keeping.content.get(alpha, keptForGood.sha256)))).toMatchObject({
      sha256: keptForGood.sha256,
    });
  });
}

function failedDeleteLetGo(entry: InterleavedErasureEntry): void {
  it('lets go of its mark where the delete of the bytes fails, so the content stays whole and due, and the erasure after it takes it', async () => {
    const { paused, keeping, sha256 } = await keptUntil(entry, keptAt + aDay);
    paused.pausedDelete().fail();

    const failed = await at(keptAt + aDay, defectOf(keeping.eraseExpired(10)));
    const headAfterTheFailure = await headOf(keeping, alpha, sha256);
    const readAfterTheFailure = await readBack(await present(keeping.content.get(alpha, sha256)));
    const erased = await at(keptAt + aDay, keeping.eraseExpired(10));

    expect([failed, headAfterTheFailure?.expiresAt, readAfterTheFailure.sha256, erased]).toEqual([
      aStepFailedAtItsPause(),
      keptAt + aDay,
      sha256,
      { erased: 1, more: false },
    ]);
    expect(await resultOf(keeping.content.get(alpha, sha256))).toBeUndefined();
  });
}

function givenUpAfter<A, E>(erasure: Effect.Effect<A, E>, markedAt: number, stall: PausedStep): Promise<A> {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(markedAt);
      const running = yield* Effect.forkChild(erasure);
      yield* Effect.promise(() => stall.reached);
      yield* Effect.yieldNow;
      yield* TestClock.adjust(erasureDeletesWithinMs);
      return yield* Fiber.join(running);
    }).pipe(Effect.provide(TestClock.layer())),
  );
}

function heldBack(text: string): { readonly stream: ReadableStream<Uint8Array>; readonly release: () => void } {
  const released = Promise.withResolvers<void>();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      await released.promise;
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return {
    stream,
    release: () => {
      released.resolve();
    },
  };
}

function deleteGivenUp(entry: InterleavedErasureEntry): void {
  it('gives up a delete that has not ended once its mark is half the time a removal takes old, records nothing and keeps the mark, and the delete given up takes nothing of the bytes a put places after the erasure that takes the mark over', async () => {
    const markedAt = keptAt + aDay;
    const { paused, keeping, sha256 } = await keptUntil(entry, markedAt);
    const stall = paused.pausedDelete();

    const givenUp = await givenUpAfter(keeping.eraseExpired(10), markedAt, stall);
    const whileMarked = await at(markedAt + 1, keeping.elsewhere.eraseExpired(10));
    const takenOver = await at(markedAt + removalLastsMs + 1, keeping.elsewhere.eraseExpired(10));
    const kept = await resultOf(keeping.content.put(alpha, textToKeep(note, 'text/plain')));
    stall.release();

    expect([givenUp, whileMarked, takenOver, kept.mediaType]).toEqual([
      { erased: 0, more: false },
      { erased: 0, more: false },
      { erased: 1, more: false },
      'text/plain',
    ]);
    expect(await readBack(await present(keeping.content.get(alpha, sha256)))).toMatchObject({ sha256 });
  });
}

function staleMarkErased(entry: InterleavedErasureEntry): void {
  it('records the erasure whose mark a put, with its digest expected, meets stale, before it keeps the content again, so the content reads as erased, never as missing, until it is kept', async () => {
    const markedAt = keptAt + aDay;
    const { paused, keeping, sha256 } = await keptUntil(entry, markedAt);
    await givenUpAfter(keeping.eraseExpired(10), markedAt, paused.pausedDelete());
    const held = heldBack(note);

    const put = resultOf(keeping.content.put(alpha, { stream: held.stream, mediaType: json, expected: { sha256 } }));
    const whileKept = await vi.waitFor(async () => {
      const head = await headOf(keeping, alpha, sha256);
      expect(head?.erasedAt).toEqual(expect.any(Number));
      return head;
    });
    held.release();

    expect([whileKept?.expiresAt, await put]).toEqual([
      undefined,
      { sha256, bytes: Buffer.byteLength(note), mediaType: json },
    ]);
    expect(await headOf(keeping, alpha, sha256)).not.toHaveProperty('erasedAt');
    expect(await readBack(await present(keeping.content.get(alpha, sha256)))).toMatchObject({ sha256 });
  });

  it('records the erasure whose mark a put of the whole content meets stale, and keeps the content again', async () => {
    const markedAt = keptAt + aDay;
    const { paused, keeping, sha256 } = await keptUntil(entry, markedAt);
    await givenUpAfter(keeping.eraseExpired(10), markedAt, paused.pausedDelete());

    const kept = await resultOf(keeping.content.put(alpha, textToKeep(note, 'text/plain')));

    expect(kept).toEqual({ sha256, bytes: Buffer.byteLength(note), mediaType: 'text/plain' });
    const head = await headOf(keeping, alpha, sha256);
    expect(head).toMatchObject({ bytes: Buffer.byteLength(note), mediaType: 'text/plain' });
    expect([head?.expiresAt, head?.erasedAt]).toEqual([undefined, undefined]);
    expect(await readBack(await present(keeping.content.get(alpha, sha256)))).toMatchObject({ sha256 });
  });
}

function nothingMore(): Promise<unknown> {
  return Promise.resolve();
}

function markTakenOverWhileDeleting(entry: InterleavedErasureEntry): void {
  it('records nothing where an erasure whose clock is past the time a removal takes took its mark over while it deleted, so the content is erased once', async () => {
    const markedAt = keptAt + aDay;
    const store = await entry.aStore();
    const takenOver: unknown[] = [];
    const overtaking = {
      during: async (): Promise<unknown> => {
        overtaking.during = nothingMore;
        return takenOver.push(await at(markedAt + removalLastsMs + 1, keeping.elsewhere.eraseExpired(10)));
      },
    };
    const keeping = await entry.aKeeping({
      ...store,
      delete: (playbook, sha256) =>
        Effect.andThen(
          Effect.promise(() => overtaking.during()),
          store.delete(playbook, sha256),
        ),
    });
    const { sha256 } = await at(keptAt, keeping.content.put(alpha, { ...textToKeep(note, json), expiresAt: markedAt }));

    const overtaken = await at(markedAt, keeping.eraseExpired(10));

    expect([overtaken, ...takenOver]).toEqual([
      { erased: 0, more: false },
      { erased: 1, more: false },
    ]);
    expect((await headOf(keeping, alpha, sha256))?.erasedAt).toBe(markedAt + removalLastsMs + 1);
  });
}

function bytesGoneBeforeTheRecord(entry: InterleavedErasureEntry): void {
  it('reads nothing of a content past its expiry whose bytes are gone with its erasure not recorded, as after a stop between the two, and the erasure after it records it', async () => {
    const { paused, keeping, sha256 } = await keptUntil(entry, keptAt + aDay);
    await resultOf(paused.store.delete(alpha, sha256));

    const read = await resultOf(keeping.content.get(alpha, sha256));
    const head = await headOf(keeping, alpha, sha256);
    const erased = await at(keptAt + aDay, keeping.eraseExpired(10));

    expect([read, head?.expiresAt, head?.erasedAt, erased]).toEqual([
      undefined,
      keptAt + aDay,
      undefined,
      { erased: 1, more: false },
    ]);
    expect((await headOf(keeping, alpha, sha256))?.erasedAt).toBe(keptAt + aDay);
  });
}

export function interleavedErasureBehaviour(entry: InterleavedErasureEntry): void {
  describe('the content a playbook keeps in a store outside its ledger until it expires, its erasure meeting its puts', () => {
    putWhileErased(entry);
    keptForGoodWhileErasing(entry);
    failedDeleteLetGo(entry);
    deleteGivenUp(entry);
    staleMarkErased(entry);
    markTakenOverWhileDeleting(entry);
    bytesGoneBeforeTheRecord(entry);
  });
}
