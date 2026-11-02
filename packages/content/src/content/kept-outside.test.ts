import { describe, expect, it } from 'vitest';

import {
  alpha,
  at,
  generated,
  json,
  octets,
  present,
  readBack,
  refusalOf,
  resultOf,
} from '../testing/content-samples.ts';
import { memoryContentHeads, memoryContentStore, type HeldIn } from '../testing/memory-content.ts';
import { aStepFailedAtItsPause, defectOf, pausableStore, settledWithin } from '../testing/paused-store.ts';
import { sha256Of } from './content-digest.ts';
import { keptOutside, removalLastsMs, removalWaitMs } from './kept-outside.ts';
import { textToKeep, type ContentToKeep } from './streamed-content.ts';

const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

const note = '{"note":"kept outside"}';

const noteDigest = sha256Of(note);

type ExpectedOf = Pick<ContentToKeep, 'expected'>;

function outsideOf(heldIn?: HeldIn) {
  const paused = pausableStore(memoryContentStore());
  return { ...keptOutside(memoryContentHeads(heldIn), paused.store), paused };
}

function removedByItsHead(): void {
  it('removes a content kept before the time it is given, so no read finds it, and keeps it again with the media type of the put after it', async () => {
    const { content, removedKeptBefore } = outsideOf();
    await at(keptAt, content.put(alpha, textToKeep(note, json)));

    const removed = await at(keptAt + 10, removedKeptBefore(alpha, noteDigest, keptAt + 1));
    const read = await resultOf(content.get(alpha, noteDigest));
    const again = await resultOf(content.put(alpha, textToKeep(note, 'text/plain')));

    expect([removed, read, again]).toEqual([
      'removed',
      undefined,
      { sha256: noteDigest, bytes: Buffer.byteLength(note), mediaType: 'text/plain' },
    ]);
  });

  it('answers held for a content its ledger holds, fresh for one kept at or after the time, and removed for a digest never kept', async () => {
    const { content, removedKeptBefore } = outsideOf((_playbook, sha256) => sha256 === noteDigest);
    await at(keptAt, content.put(alpha, textToKeep(note, json)));
    await at(keptAt, content.put(alpha, textToKeep('another', json)));

    const removed = [
      await resultOf(removedKeptBefore(alpha, noteDigest, keptAt + 1)),
      await resultOf(removedKeptBefore(alpha, sha256Of('another'), keptAt)),
      await resultOf(removedKeptBefore(alpha, sha256Of('never kept'), keptAt + 1)),
    ];

    expect(removed).toEqual(['held', 'fresh', 'removed']);
    expect(await readBack(await present(content.get(alpha, noteDigest)))).toMatchObject({ sha256: noteDigest });
  });
}

function touchedByItsPuts(): void {
  it('takes a put of a digest it holds, whole or with its digest expected, as the time the content was kept', async () => {
    const { content, removedKeptBefore } = outsideOf();
    await at(keptAt, content.put(alpha, textToKeep(note, json)));

    await at(keptAt + 10, content.put(alpha, textToKeep(note, json)));
    const afterTheWholePut = await resultOf(removedKeptBefore(alpha, noteDigest, keptAt + 5));
    await at(keptAt + 20, content.put(alpha, { ...textToKeep(note, json), expected: { sha256: noteDigest } }));
    const afterThePutOfItsDigest = await resultOf(removedKeptBefore(alpha, noteDigest, keptAt + 15));
    const afterBoth = await resultOf(removedKeptBefore(alpha, noteDigest, keptAt + 21));

    expect([afterTheWholePut, afterThePutOfItsDigest, afterBoth]).toEqual(['fresh', 'fresh', 'removed']);
  });

  it('places the bytes of a head that stands without them, whole or with its digest expected, with the media type of the head', async () => {
    const { content, paused } = outsideOf();
    paused.pausedPlace().fail();
    const failedPlace = await resultOf(defectOf(content.put(alpha, textToKeep(note, json))));

    const withItsDigest = await resultOf(
      content.put(alpha, { ...textToKeep(note, 'text/plain'), expected: { sha256: noteDigest } }),
    );
    const read = await present(content.get(alpha, noteDigest));

    expect(failedPlace).toEqual(aStepFailedAtItsPause());
    expect(withItsDigest).toEqual({ sha256: noteDigest, bytes: Buffer.byteLength(note), mediaType: json });
    expect(await readBack(read)).toMatchObject({ sha256: noteDigest, mediaType: json });
  });
}

function putWhileRemoved(): void {
  it.each([
    ['whole', (): ExpectedOf => ({})],
    ['with its digest expected', (sha256: string): ExpectedOf => ({ expected: { sha256 } })],
  ])(
    'put %s, waits while the removal deletes its bytes and keeps them whole once the removal is done',
    async (_how, expectedOf) => {
      const { content, removedKeptBefore, paused } = outsideOf();
      const large = await generated(2_500_000);
      await at(keptAt, content.put(alpha, large.content()));
      const deleting = paused.pausedDelete();

      const removal = resultOf(removedKeptBefore(alpha, large.sha256, Date.now()));
      await deleting.reached;
      const put = resultOf(content.put(alpha, { ...large.content(), ...expectedOf(large.sha256) }));
      const settledBefore = await settledWithin(put, 300);
      deleting.release();

      expect([settledBefore, await removal, await put]).toEqual([
        false,
        'removed',
        { sha256: large.sha256, bytes: 2_500_000, mediaType: octets },
      ]);
      expect(await readBack(await present(content.get(alpha, large.sha256)))).toMatchObject({
        sha256: large.sha256,
        bytes: 2_500_000,
      });
    },
  );
}

function refusedOnceItWaited(): void {
  it(
    'refuses as unavailable a put that waits longer than the removal may take to delete, keeping nothing of it',
    { timeout: 20_000 },
    async () => {
      const { content, removedKeptBefore, paused } = outsideOf();
      await at(keptAt, content.put(alpha, textToKeep(note, json)));
      const deleting = paused.pausedDelete();
      const removal = resultOf(removedKeptBefore(alpha, noteDigest, Date.now()));
      await deleting.reached;

      const begun = Date.now();
      const refused = await refusalOf(content.put(alpha, textToKeep(note, json)));
      const waited = Date.now() - begun;
      deleting.release();

      expect(refused).toMatchObject({
        _tag: 'content_refused',
        because: 'unavailable',
        detail: `The content kept under ${noteDigest} is being removed, so it is not kept now; keeping it again in a moment keeps it whole`,
      });
      expect(waited).toBeGreaterThanOrEqual(removalWaitMs);
      expect(await removal).toBe('removed');
      expect(await resultOf(content.get(alpha, noteDigest))).toBeUndefined();
    },
  );
}

function stoppedRemovalsFinished(): void {
  it('finishes a removal that stalled before its end once the time a removal takes has run out, for a put or for a removal after it, answers removed to one before, and lets the stalled one, failing at last, take back no mark it no longer holds', async () => {
    const { content, removedKeptBefore, paused } = outsideOf();
    const markedAt = keptAt + 2 * removalLastsMs;
    const notes = [note, 'a second note'];
    await Promise.all(notes.map((text) => at(keptAt, content.put(alpha, textToKeep(text, json)))));
    const stalls = [paused.pausedDelete(), paused.pausedDelete()];
    const stalled = notes.map((text) => at(markedAt, defectOf(removedKeptBefore(alpha, sha256Of(text), markedAt))));
    await Promise.all(stalls.map(({ reached }) => reached));

    const whileItRuns = await at(markedAt + 1, removedKeptBefore(alpha, noteDigest, markedAt + 1));
    const put = await at(markedAt + removalLastsMs + 1, content.put(alpha, textToKeep(note, 'text/plain')));
    const removal = await at(
      markedAt + removalLastsMs + 1,
      removedKeptBefore(alpha, sha256Of('a second note'), markedAt),
    );

    for (const stall of stalls) {
      stall.fail();
    }

    expect(await Promise.all(stalled)).toEqual([aStepFailedAtItsPause(), aStepFailedAtItsPause()]);
    expect([whileItRuns, put.mediaType, removal]).toEqual(['removed', 'text/plain', 'removed']);
    expect(await readBack(await present(content.get(alpha, noteDigest)))).toMatchObject({ mediaType: 'text/plain' });
    expect(await resultOf(content.get(alpha, sha256Of('a second note')))).toBeUndefined();
  });

  it('leaves to a removal that took over from one too slow to end the head it clears, so the slow one clears nothing', async () => {
    const { content, removedKeptBefore, paused } = outsideOf();
    await at(keptAt, content.put(alpha, textToKeep(note, json)));
    const slow = paused.pausedDelete();
    const slowRemoval = at(keptAt + removalLastsMs, removedKeptBefore(alpha, noteDigest, keptAt + 1));
    await slow.reached;

    const takenOver = await at(keptAt + 3 * removalLastsMs, removedKeptBefore(alpha, noteDigest, keptAt + 1));
    slow.release();
    const slowOne = await slowRemoval;
    const again = await at(keptAt + 3 * removalLastsMs, content.put(alpha, textToKeep(note, 'text/plain')));

    expect([takenOver, slowOne, again.mediaType]).toEqual(['removed', 'removed', 'text/plain']);
    expect(await readBack(await present(content.get(alpha, noteDigest)))).toMatchObject({ sha256: noteDigest });
  });
}

function headlessRemoved(): void {
  it('removes the bytes its store holds under a digest that has no head, as a content kept before heads were, and holds back a put that meets that removal', async () => {
    const { content, removedKeptBefore, paused } = outsideOf();
    const staged = await resultOf(paused.store.stage(alpha, textToKeep(note, json)));
    await resultOf(staged.placed(json));
    const deleting = paused.pausedDelete();

    const removal = resultOf(removedKeptBefore(alpha, noteDigest, keptAt));
    await deleting.reached;
    const readWhileRemoved = (await present(content.get(alpha, noteDigest))).mediaType;
    const put = resultOf(content.put(alpha, textToKeep(note, 'text/plain')));
    const settledBefore = await settledWithin(put, 300);
    deleting.release();

    expect([readWhileRemoved, settledBefore, await removal, (await put).mediaType]).toEqual([
      json,
      false,
      'removed',
      'text/plain',
    ]);
    expect(await readBack(await present(content.get(alpha, noteDigest)))).toMatchObject({ mediaType: 'text/plain' });
  });
}

function readAsItsHead(): void {
  it('reads a content with the media type of its head whatever its bytes were placed with, and with that of its bytes where no head stands', async () => {
    const { content, paused } = outsideOf();
    const staged = await resultOf(paused.store.stage(alpha, textToKeep(note, 'text/plain')));
    await resultOf(staged.placed('text/plain'));

    const headless = (await present(content.get(alpha, noteDigest))).mediaType;
    const kept = await resultOf(content.put(alpha, textToKeep(note, json)));
    const read = await present(content.get(alpha, noteDigest));

    expect([headless, kept.mediaType, read.mediaType]).toEqual(['text/plain', json, json]);
    expect(await readBack(read)).toMatchObject({ sha256: noteDigest });
  });
}

function failedDeletesLetGo(): void {
  it('lets go of its mark where its delete fails, so a put keeps the content at once and a removal after it marks it again', async () => {
    const { content, removedKeptBefore, paused } = outsideOf();
    await at(keptAt, content.put(alpha, textToKeep(note, json)));
    paused.pausedDelete().fail();

    const failed = await at(keptAt + removalLastsMs, defectOf(removedKeptBefore(alpha, noteDigest, keptAt + 1)));
    const again = await at(keptAt + removalLastsMs + 1, content.put(alpha, textToKeep(note, json)));
    const removed = await at(
      keptAt + 3 * removalLastsMs,
      removedKeptBefore(alpha, noteDigest, keptAt + 2 * removalLastsMs),
    );

    expect([failed, again.mediaType, removed]).toEqual([aStepFailedAtItsPause(), json, 'removed']);
    expect(await resultOf(content.get(alpha, noteDigest))).toBeUndefined();
  });

  it('lets go of the head its mark alone made where the delete of bytes with no head fails, so a put after it keeps them as new', async () => {
    const { content, removedKeptBefore, paused } = outsideOf();
    paused.pausedDelete().fail();

    const failed = await resultOf(defectOf(removedKeptBefore(alpha, noteDigest, keptAt)));
    const kept = await resultOf(content.put(alpha, textToKeep(note, 'text/plain')));

    expect([failed, kept]).toEqual([
      aStepFailedAtItsPause(),
      { sha256: noteDigest, bytes: Buffer.byteLength(note), mediaType: 'text/plain' },
    ]);
  });
}

describe('the content kept outside the ledger, removed by its head', () => {
  removedByItsHead();
  touchedByItsPuts();
  headlessRemoved();
  readAsItsHead();
  failedDeletesLetGo();
});

describe('a put of a content outside the ledger that meets its removal', () => {
  putWhileRemoved();
  refusedOnceItWaited();
  stoppedRemovalsFinished();
});
