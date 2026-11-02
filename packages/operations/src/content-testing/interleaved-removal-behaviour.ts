import { removalLastsMs, sha256Of, textToKeep, type ContentStore, type ContentToKeep } from '@on.auto/content';
import {
  aStepFailedAtItsPause,
  alpha,
  at,
  defectOf,
  generated,
  json,
  octets,
  pausableStore,
  present,
  readBack,
  resultOf,
  settledWithin,
} from '@on.auto/content/testing';
import { describe, expect, it } from 'vitest';

import type { ContentHolders } from '../held-content/content-declaration.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';
import { anHour, firstNotes, kept, keptAt, noteHolders, noted } from './held-notes.ts';

export interface InterleavedRemovalEntry {
  readonly aStore: () => Promise<ContentStore>;
  readonly aLedger: (holders: ContentHolders, store: ContentStore) => Promise<LedgerPorts>;
}

type ExpectedOf = (sha256: string) => Pick<ContentToKeep, 'expected'>;

const note = '{"note":"kept outside"}';

const whole: ExpectedOf = () => ({});

const withItsDigest: ExpectedOf = (sha256) => ({ expected: { sha256 } });

async function interleavedOn(entry: InterleavedRemovalEntry) {
  const paused = pausableStore(await entry.aStore());
  return { ledger: await entry.aLedger(noteHolders, paused.store), paused };
}

function putWhileDeleted(entry: InterleavedRemovalEntry): void {
  it.each([
    ['whole', whole],
    ['with its digest expected', withItsDigest],
  ])(
    'waits, put %s while the removal of its digest deletes the bytes, until the removal is done, then keeps the bytes whole, so the hold its fact records names bytes the store holds',
    async (_how, expectedOf) => {
      const { ledger, paused } = await interleavedOn(entry);
      const large = await generated(2_500_000);
      await at(keptAt, ledger.content.put(alpha, large.content()));
      const deleting = paused.pausedDelete();

      const removal = resultOf(ledger.removeUnheld(alpha, large.sha256));
      await deleting.reached;
      const put = resultOf(ledger.content.put(alpha, { ...large.content(), ...expectedOf(large.sha256) }));
      const settledBefore = await settledWithin(put, 300);
      deleting.release();
      const [removed, putAfter] = [await removal, await put];
      await noted(ledger, firstNotes, kept(large.sha256));

      expect([settledBefore, removed, putAfter]).toEqual([
        false,
        'removed',
        { sha256: large.sha256, bytes: 2_500_000, mediaType: octets },
      ]);
      expect(await at(Date.now() + 2 * anHour, ledger.removeUnheld(alpha, large.sha256))).toBe('held');
      expect(await readBack(await present(ledger.content.get(alpha, large.sha256)))).toMatchObject({
        sha256: large.sha256,
        bytes: 2_500_000,
      });
    },
  );
}

function placedAfterTheRemovalAsked(entry: InterleavedRemovalEntry): void {
  it('answers fresh to a removal that asks while the bytes of a put are on their way to the store, and leaves them whole', async () => {
    const { ledger, paused } = await interleavedOn(entry);
    const large = await generated(2_500_000);
    const placing = paused.pausedPlace();

    const put = resultOf(ledger.content.put(alpha, large.content()));
    await placing.reached;
    const removed = await resultOf(ledger.removeUnheld(alpha, large.sha256));
    placing.release();

    expect([removed, await put]).toEqual(['fresh', { sha256: large.sha256, bytes: 2_500_000, mediaType: octets }]);
    expect(await readBack(await present(ledger.content.get(alpha, large.sha256)))).toMatchObject({
      sha256: large.sha256,
      bytes: 2_500_000,
    });
  });
}

function stoppedRemovalsFinished(entry: InterleavedRemovalEntry): void {
  it('finishes a removal that stalled after it marked its digest once the time a removal takes has run out, for a put or for a removal after it, and lets the stalled one, failing at last, take back no mark it no longer holds', async () => {
    const { ledger, paused } = await interleavedOn(entry);
    const markedAt = keptAt + 2 * anHour;
    const notes = [note, 'a second note'];
    await Promise.all(notes.map((text) => at(keptAt, ledger.content.put(alpha, textToKeep(text, json)))));
    const stalls = [paused.pausedDelete(), paused.pausedDelete()];
    const stalled = notes.map((text) => at(markedAt, defectOf(ledger.removeUnheld(alpha, sha256Of(text)))));
    await Promise.all(stalls.map(({ reached }) => reached));

    const whileItRuns = await at(markedAt + 1, ledger.removeUnheld(alpha, sha256Of(note)));
    const put = await at(markedAt + removalLastsMs + 1, ledger.content.put(alpha, textToKeep(note, 'text/plain')));
    const removal = await at(markedAt + removalLastsMs + 1, ledger.removeUnheld(alpha, sha256Of('a second note')));
    for (const stall of stalls) {
      stall.fail();
    }

    expect(await Promise.all(stalled)).toEqual([aStepFailedAtItsPause(), aStepFailedAtItsPause()]);
    expect([whileItRuns, put.mediaType, removal]).toEqual(['removed', 'text/plain', 'removed']);
    expect(await readBack(await present(ledger.content.get(alpha, sha256Of(note))))).toMatchObject({
      mediaType: 'text/plain',
    });
    expect(await resultOf(ledger.content.get(alpha, sha256Of('a second note')))).toBeUndefined();
  });
}

function marksLetGo(entry: InterleavedRemovalEntry): void {
  it('lets go of its mark where its delete fails, so a put keeps the content at once and a removal after it removes it, and lets go of the head its mark alone made', async () => {
    const { ledger, paused } = await interleavedOn(entry);
    await at(keptAt, ledger.content.put(alpha, textToKeep(note, json)));
    paused.pausedDelete().fail();
    paused.pausedDelete().fail();

    const failed = [
      await at(keptAt + 2 * anHour, defectOf(ledger.removeUnheld(alpha, sha256Of(note)))),
      await at(keptAt + 2 * anHour, defectOf(ledger.removeUnheld(alpha, sha256Of('never kept')))),
    ];
    const again = [
      await at(keptAt + 2 * anHour, ledger.content.put(alpha, textToKeep(note, json))),
      await at(keptAt + 2 * anHour, ledger.content.put(alpha, textToKeep('never kept', 'text/plain'))),
    ];
    const removed = await at(keptAt + 4 * anHour, ledger.removeUnheld(alpha, sha256Of(note)));

    expect(failed).toEqual([aStepFailedAtItsPause(), aStepFailedAtItsPause()]);
    expect(again.map(({ bytes, mediaType }) => [bytes, mediaType])).toEqual([
      [Buffer.byteLength(note), json],
      [Buffer.byteLength('never kept'), 'text/plain'],
    ]);
    expect(removed).toBe('removed');
    expect(await resultOf(ledger.content.get(alpha, sha256Of(note)))).toBeUndefined();
  });
}

function headlessRemoved(entry: InterleavedRemovalEntry): void {
  it('removes the bytes its store holds under a digest without a head, as a content kept before heads were, and holds back a put that meets that removal', async () => {
    const { ledger, paused } = await interleavedOn(entry);
    const large = await generated(2_500_000);
    const staged = await resultOf(paused.store.stage(alpha, large.content()));
    await resultOf(staged.placed(octets));
    const deleting = paused.pausedDelete();

    const removal = resultOf(ledger.removeUnheld(alpha, large.sha256));
    await deleting.reached;
    const put = resultOf(ledger.content.put(alpha, { ...large.content(), mediaType: json }));
    const settledBefore = await settledWithin(put, 300);
    deleting.release();

    expect([settledBefore, await removal, (await put).mediaType]).toEqual([false, 'removed', json]);
    expect(await readBack(await present(ledger.content.get(alpha, large.sha256)))).toMatchObject({
      sha256: large.sha256,
      mediaType: json,
    });
  });
}

export function interleavedRemovalBehaviour(entry: InterleavedRemovalEntry): void {
  describe('the content a playbook keeps in a store outside its ledger, its removal meeting its puts', () => {
    putWhileDeleted(entry);
    placedAfterTheRemovalAsked(entry);
    stoppedRemovalsFinished(entry);
    marksLetGo(entry);
    headlessRemoved(entry);
  });
}
