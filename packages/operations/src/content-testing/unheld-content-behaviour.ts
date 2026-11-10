import { sha256Of } from '@on.auto/content';
import { alpha, beta, keptTextOf } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  anHour,
  attached,
  closed,
  erasing,
  firstNotes,
  kept,
  keptAt,
  keptIn,
  letGo,
  noteHolders,
  noted,
  notesOfTheOrg,
  removedAt,
  secondNotes,
  firstWritings,
  written,
  writtenNotes,
  wrote,
  type UnheldContentEntry,
} from './held-notes.ts';
import { removedContentBehaviour } from './removed-content-behaviour.ts';

const note = '{"note":"the first"}';

const another = '{"note":"another"}';

function removedOnceItsHourPassed(entry: UnheldContentEntry): void {
  it('leaves a content nothing holds fresh for the hour after it was kept, and removes it once that hour has passed', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const sha256 = await keptIn(ledger, alpha, note, keptAt);

    const withinTheHour = await removedAt(ledger, keptAt + anHour, alpha, sha256);
    const keptWithin = await keptTextOf(ledger.content, alpha, sha256);
    const pastTheHour = await removedAt(ledger, keptAt + anHour + 1, alpha, sha256);

    expect([withinTheHour, keptWithin, pastTheHour]).toEqual(['fresh', note, 'removed']);
    expect(await keptTextOf(ledger.content, alpha, sha256)).toBeUndefined();
  });

  it('answers removed for a digest the playbook never kept', async () => {
    const ledger = await entry.aLedger(noteHolders);

    expect(await removedAt(ledger, keptAt, alpha, sha256Of('never kept'))).toBe('removed');
  });
}

function heldThroughTheRace(entry: UnheldContentEntry): void {
  it('answers fresh to a removal between a put of a digest kept long before and the hold that follows it, then held once the hold is recorded, so the bytes the hold claims stay', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const sha256 = await keptIn(ledger, alpha, note, keptAt);

    await keptIn(ledger, alpha, note, keptAt + 2 * anHour);
    const betweenThePutAndItsHold = await removedAt(ledger, keptAt + 2 * anHour + 1000, alpha, sha256);
    await noted(ledger, firstNotes, kept(sha256));
    const onceHeld = await removedAt(ledger, keptAt + 4 * anHour, alpha, sha256);

    expect([betweenThePutAndItsHold, onceHeld]).toEqual(['fresh', 'held']);
    expect(await keptTextOf(ledger.content, alpha, sha256)).toBe(note);
  });
}

function heldByItsPlaybook(entry: UnheldContentEntry): void {
  it('keeps a content any stream of its playbook holds, past its hour, and holds nothing for another playbook or for a stream of the org', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const sha256 = await keptIn(ledger, alpha, note, keptAt);
    await keptIn(ledger, beta, note, keptAt);
    await noted(ledger, secondNotes, kept(sha256));
    await noted(ledger, notesOfTheOrg, kept(sha256));

    const removed = [
      await removedAt(ledger, keptAt + 2 * anHour, alpha, sha256),
      await removedAt(ledger, keptAt + 2 * anHour, beta, sha256),
    ];

    expect(removed).toEqual(['held', 'removed']);
    expect(await keptTextOf(ledger.content, alpha, sha256)).toBe(note);
    expect(await keptTextOf(ledger.content, beta, sha256)).toBeUndefined();
  });
}

function letGoByItsReleases(entry: UnheldContentEntry): void {
  it('lets go of one hold for each release that names its digest, so two holds take two releases, and a release before any hold lets go of none to come', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const sha256 = await keptIn(ledger, alpha, note, keptAt);
    await noted(ledger, firstNotes, letGo(sha256), kept(sha256), attached(sha256));

    await noted(ledger, firstNotes, letGo(sha256));
    const afterOneRelease = await removedAt(ledger, keptAt + 2 * anHour, alpha, sha256);
    await noted(ledger, firstNotes, letGo(sha256));
    const afterTwo = await removedAt(ledger, keptAt + 2 * anHour, alpha, sha256);

    expect([afterOneRelease, afterTwo]).toEqual(['held', 'removed']);
  });

  it('lets go of every hold of its stream for a release of all of them, and of no hold of another stream', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const first = await keptIn(ledger, alpha, note, keptAt);
    const second = await keptIn(ledger, alpha, another, keptAt);
    await noted(ledger, firstNotes, kept(first), attached(second));
    await noted(ledger, secondNotes, kept(second));

    await noted(ledger, firstNotes, closed);
    const removed = [
      await removedAt(ledger, keptAt + 2 * anHour, alpha, first),
      await removedAt(ledger, keptAt + 2 * anHour, alpha, second),
    ];

    expect(removed).toEqual(['removed', 'held']);
  });

  it('holds nothing for a fact whose pointers name no field of its data, or a field that holds no digest', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const sha256 = await keptIn(ledger, alpha, note, keptAt);

    await noted(
      ledger,
      firstNotes,
      { type: 'note_kept', data: {} },
      { type: 'note_kept', data: { sha256: 'not a digest' } },
      attached(sha256.toUpperCase()),
    );

    expect(await removedAt(ledger, keptAt + 2 * anHour, alpha, sha256)).toBe('removed');
  });
}

function heldByThePayloadsKeptOutside(entry: UnheldContentEntry): void {
  it('keeps the payloads a fact keeps outside by their digests, one alone and each of a list, past their hour, and holds nothing for a payload inline', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const [body, part, inline] = [
      await keptIn(ledger, alpha, note, keptAt),
      await keptIn(ledger, alpha, another, keptAt),
      await keptIn(ledger, alpha, '"inline"', keptAt),
    ];

    await wrote(
      ledger,
      firstWritings,
      written({ body_sha256: body, body_bytes: note.length, parts: [{ sha256: part, bytes: another.length }] }),
      written({ body: inline }),
    );
    const removed = await Promise.all(
      [body, part, inline].map((sha256) => removedAt(ledger, keptAt + 2 * anHour, alpha, sha256)),
    );

    expect(removed).toEqual(['held', 'held', 'removed']);
  });

  it('refuses, and records nothing, a fact that names a payload by its digest with no whole number of bytes beside it', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const sha256 = await keptIn(ledger, alpha, note, keptAt);

    const refused = wrote(ledger, firstWritings, written({ body_sha256: sha256, body_bytes: -1 }));

    await expect(refused).rejects.toThrow(`A payload of the fact is named by "${sha256}" at /body_sha256 beside -1`);
    expect(await Effect.runPromise(ledger.load(firstWritings, writtenNotes))).toEqual({ state: null, version: 0 });
    expect(await removedAt(ledger, keptAt + 2 * anHour, alpha, sha256)).toBe('removed');
  });
}

function letGoByAScrub(entry: UnheldContentEntry): void {
  it('lets go of the hold of a fact a scrub takes its digest from, keeps the hold of one whose scrubbed data still names it, and holds nothing for a fact of the org it scrubs', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const first = await keptIn(ledger, alpha, note, keptAt);
    const second = await keptIn(ledger, alpha, another, keptAt);
    await noted(ledger, firstNotes, kept(first));
    await noted(ledger, secondNotes, kept(second));
    await noted(ledger, notesOfTheOrg, kept(first));

    await Effect.runPromise(ledger.scrubFact(firstNotes, 1, erasing(1, {})));
    await Effect.runPromise(ledger.scrubFact(secondNotes, 1, erasing(1, { sha256: second })));
    await Effect.runPromise(ledger.scrubFact(notesOfTheOrg, 1, erasing(1, { sha256: first })));
    const removed = [
      await removedAt(ledger, keptAt + 2 * anHour, alpha, first),
      await removedAt(ledger, keptAt + 2 * anHour, alpha, second),
    ];

    expect(removed).toEqual(['removed', 'held']);
  });
}

export function unheldContentBehaviour(entry: UnheldContentEntry): void {
  describe('the content a playbook kept, removed only when nothing holds it and its hour has passed', () => {
    removedOnceItsHourPassed(entry);
    heldThroughTheRace(entry);
    heldByItsPlaybook(entry);
    heldByThePayloadsKeptOutside(entry);
  });
  describe('the holds on a content, let go of', () => {
    letGoByItsReleases(entry);
    letGoByAScrub(entry);
  });
  removedContentBehaviour(entry);
}
