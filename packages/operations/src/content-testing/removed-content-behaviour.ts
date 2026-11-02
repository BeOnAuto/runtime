import { sha256Of, textToKeep } from '@on.auto/content';
import { alpha, at, beta, generated, json, present, readBack, resultOf } from '@on.auto/content/testing';
import { describe, expect, it } from 'vitest';

import { anHour, keptAt, noteHolders, removedAt, type UnheldContentEntry } from './held-notes.ts';

const pastItsHour = keptAt + anHour + 1;

function removedWhole(entry: UnheldContentEntry): void {
  it('removes a content of one chunk and one of several nothing holds once their hour has passed, so no read finds them, and leaves the other contents of the playbook and the same digest in another playbook whole', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const [small, large, other] = [await generated(1000), await generated(2_500_000), await generated(1000, 11)];
    await at(keptAt, ledger.content.put(alpha, small.content()));
    await at(keptAt, ledger.content.put(alpha, large.content()));
    await at(keptAt + anHour, ledger.content.put(alpha, other.content()));
    await at(keptAt, ledger.content.put(beta, large.content()));

    const removed = [
      await removedAt(ledger, pastItsHour, alpha, small.sha256),
      await removedAt(ledger, pastItsHour, alpha, large.sha256),
    ];

    expect(removed).toEqual(['removed', 'removed']);
    expect(await resultOf(ledger.content.get(alpha, small.sha256))).toBeUndefined();
    expect(await resultOf(ledger.content.get(alpha, large.sha256))).toBeUndefined();
    expect(await readBack(await present(ledger.content.get(alpha, other.sha256)))).toMatchObject({
      sha256: other.sha256,
      bytes: 1000,
    });
    expect(await readBack(await present(ledger.content.get(beta, large.sha256)))).toMatchObject({
      sha256: large.sha256,
      bytes: 2_500_000,
    });
  });

  it('removes a content its playbook does not hold, or no longer holds, without failing, and answers it removed', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const { sha256 } = await at(keptAt, ledger.content.put(alpha, textToKeep('{"a":1}', json)));

    const removed = [
      await removedAt(ledger, pastItsHour, beta, sha256),
      await removedAt(ledger, pastItsHour, alpha, sha256),
      await removedAt(ledger, pastItsHour, alpha, sha256),
    ];

    expect(removed).toEqual(['removed', 'removed', 'removed']);
    expect(await resultOf(ledger.content.get(alpha, sha256))).toBeUndefined();
  });
}

function keptFresh(entry: UnheldContentEntry): void {
  it.each([
    ['of one chunk', 1000],
    ['of several chunks', 2_500_000],
  ])(
    'takes the time a content %s its playbook holds was put again, whole or with its digest, as the time it was kept, so a removal leaves it for the hour after that put',
    async (_size, bytes) => {
      const ledger = await entry.aLedger(noteHolders);
      const { sha256, content } = await generated(bytes);
      await at(keptAt, ledger.content.put(alpha, content()));

      await at(keptAt + 10, ledger.content.put(alpha, content()));
      const afterTheWholePut = await removedAt(ledger, pastItsHour, alpha, sha256);
      await at(keptAt + 20, ledger.content.put(alpha, { ...content(), expected: { sha256 } }));
      const afterThePutOfItsDigest = await removedAt(ledger, pastItsHour + 10, alpha, sha256);
      const afterBoth = await removedAt(ledger, pastItsHour + 20, alpha, sha256);

      expect([afterTheWholePut, afterThePutOfItsDigest, afterBoth]).toEqual(['fresh', 'fresh', 'removed']);
      expect(await resultOf(ledger.content.get(alpha, sha256))).toBeUndefined();
    },
  );
}

function keptAgainAfterRemoval(entry: UnheldContentEntry): void {
  it('keeps a content put again after its removal, with the media type of the put after it', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const large = await generated(2_500_000);
    const small = await at(keptAt, ledger.content.put(alpha, textToKeep('{"a":1}', json)));
    await at(keptAt, ledger.content.put(alpha, large.content()));
    await removedAt(ledger, pastItsHour, alpha, small.sha256);
    await removedAt(ledger, pastItsHour, alpha, large.sha256);

    const kept = [
      await resultOf(ledger.content.put(alpha, textToKeep('{"a":1}', 'text/plain'))),
      await resultOf(ledger.content.put(alpha, { ...large.content(), mediaType: json })),
    ];

    expect(kept).toEqual([
      { sha256: sha256Of('{"a":1}'), bytes: 7, mediaType: 'text/plain' },
      { sha256: large.sha256, bytes: 2_500_000, mediaType: json },
    ]);
    expect(await readBack(await present(ledger.content.get(alpha, large.sha256)))).toMatchObject({
      sha256: large.sha256,
      bytes: 2_500_000,
      mediaType: json,
    });
  });

  it('leaves a content whole or not at all where a removal meets two puts of its digest', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const large = await generated(2_500_000);
    await at(keptAt, ledger.content.put(alpha, large.content()));

    await Promise.all([
      resultOf(ledger.removeUnheld(alpha, large.sha256)),
      resultOf(ledger.content.put(alpha, large.content())),
      resultOf(ledger.content.put(alpha, large.content())),
    ]);
    const left = await resultOf(ledger.content.get(alpha, large.sha256));
    const digestsRead = await Promise.all(
      [left].filter((held) => held !== undefined).map(async (held) => (await readBack(held)).sha256),
    );

    expect(new Set([large.sha256, ...digestsRead])).toEqual(new Set([large.sha256]));
  });
}

export function removedContentBehaviour(entry: UnheldContentEntry): void {
  describe('the content a playbook kept, removed once nothing holds it and its hour has passed', () => {
    removedWhole(entry);
    keptFresh(entry);
    keptAgainAfterRemoval(entry);
  });
}
