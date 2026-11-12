import { textToKeep, type ExpiredErased } from '@on.auto/content';
import { alpha, at, json, resultOf } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ContentHolders } from '../held-content/content-declaration.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';
import { PayloadErased } from '../payloads/payload-erased.ts';
import { payloadReaderOf } from '../payloads/payload-reader.ts';
import {
  anHour,
  firstNotes,
  firstWritings,
  heldNotes,
  kept,
  keptAt,
  noteHolders,
  noted,
  removedAt,
  written,
  writtenNotes,
  wrote,
} from './held-notes.ts';

export interface ErasingLedger {
  readonly ledger: LedgerPorts;
  readonly eraseExpired: (most: number) => Effect.Effect<ExpiredErased>;
}

export interface ErasedContentEntry {
  readonly aLedger: (holders: ContentHolders) => Promise<ErasingLedger>;
}

const aDay = 24 * anHour;

const held = '{"note":"held, until it expires"}';

const unheld = '{"note":"held by nothing, until it expires"}';

function keptUntil(ledger: LedgerPorts, text: string, expiresAt: number): Promise<string> {
  return at(keptAt, ledger.content.put(alpha, { ...textToKeep(text, json), expiresAt })).then(({ sha256 }) => sha256);
}

function erasedWhileHeld(entry: ErasedContentEntry): void {
  it('erases a content its playbook holds all the same, leaves the fact that holds it as it was and the hold standing, and removes what is left of one nothing holds once its hour has passed', async () => {
    const { ledger, eraseExpired } = await entry.aLedger(noteHolders);
    const [heldDigest, unheldDigest] = [
      await keptUntil(ledger, held, keptAt + aDay),
      await keptUntil(ledger, unheld, keptAt + aDay),
    ];
    await noted(ledger, firstNotes, kept(heldDigest));

    const erased = await at(keptAt + aDay, eraseExpired(10));
    const removed = [
      await removedAt(ledger, keptAt + aDay, alpha, heldDigest),
      await removedAt(ledger, keptAt + aDay, alpha, unheldDigest),
    ];
    const fact = await Effect.runPromise(ledger.factAt(firstNotes, 1, heldNotes.eventSchema));

    expect([erased, removed, fact?.data]).toEqual([
      { erased: 2, more: false },
      ['held', 'removed'],
      { sha256: heldDigest },
    ]);
    expect([
      await resultOf(ledger.content.getHead(alpha, heldDigest)),
      await resultOf(ledger.content.getHead(alpha, unheldDigest)),
    ]).toEqual([{ bytes: Buffer.byteLength(held), mediaType: json, keptAt, erasedAt: keptAt + aDay }, undefined]);
  });
}

function erasedPayloadsRefused(entry: ErasedContentEntry): void {
  it('refuses, and records nothing, a fact that names as its payload a content whose bytes were erased', async () => {
    const { ledger, eraseExpired } = await entry.aLedger(noteHolders);
    const sha256 = await keptUntil(ledger, held, keptAt + aDay);
    await at(keptAt + aDay, eraseExpired(10));

    const refused = wrote(ledger, firstWritings, written({ body_sha256: sha256, body_bytes: Buffer.byteLength(held) }));

    await expect(refused).rejects.toThrow(`A fact names the payload ${sha256} of playbook/acme/alpha/`);
    expect(await Effect.runPromise(ledger.load(firstWritings, writtenNotes))).toEqual({ state: null, version: 0 });
  });
}

function erasedPayloadsRead(entry: ErasedContentEntry): void {
  it('answers a payload whose bytes were erased as erased, never as missing', async () => {
    const { ledger, eraseExpired } = await entry.aLedger(noteHolders);
    const sha256 = await keptUntil(ledger, held, keptAt + aDay);
    await at(keptAt + aDay, eraseExpired(10));

    const reader = payloadReaderOf({ owner: alpha, content: ledger.content });
    const failure = await Effect.runPromise(Effect.flip(reader.text({ sha256, bytes: Buffer.byteLength(held) })));

    expect(failure).toEqual(
      new PayloadErased({ ...alpha, sha256, message: `The payload kept under ${sha256} expired and was erased` }),
    );
  });
}

export function erasedContentBehaviour(entry: ErasedContentEntry): void {
  describe('the content a playbook kept until it expires, erased whatever holds it', () => {
    erasedWhileHeld(entry);
    erasedPayloadsRefused(entry);
    erasedPayloadsRead(entry);
  });
}
