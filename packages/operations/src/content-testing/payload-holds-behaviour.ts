import { sha256Of } from '@on.auto/content';
import { alpha } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ContentHolders } from '../held-content/content-declaration.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';
import {
  anHour,
  erasingWritten,
  firstWritings,
  keptAt,
  keptIn,
  noteHolders,
  removedAt,
  written,
  writtenNotes,
  wrote,
  type UnheldContentEntry,
} from './held-notes.ts';

const writingsOfTheOrg = 'org/acme/writings/w1';

const note = '{"note":"the first"}';

const threeMiB = 3 * 1024 * 1024;

const withoutWrittenNotes: ContentHolders = new Map(
  [...noteHolders].filter(([type]: readonly [string, unknown]) => type !== 'note_written'),
);

function pageOf(ledger: LedgerPorts) {
  return Effect.runPromise(ledger.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 100 }));
}

function versionOf(ledger: LedgerPorts, stream: string): Promise<number> {
  return Effect.runPromise(Effect.map(ledger.load(stream, writtenNotes), ({ version }) => version));
}

function measuredByTheirPayloads(entry: UnheldContentEntry): void {
  it('counts toward the bound of a page the payloads its facts keep outside, by the size each names', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const sha256 = await keptIn(ledger, alpha, note, keptAt);

    await wrote(ledger, firstWritings, written({ body_sha256: sha256, body_bytes: threeMiB }));
    await wrote(ledger, firstWritings, written({ body_sha256: sha256, body_bytes: threeMiB }));
    const page = await pageOf(ledger);

    expect([page.records.length, page.hasMore]).toEqual([1, true]);
  });

  it('measures a fact again when a scrub takes its payload back into its data', async () => {
    const ledger = await entry.aLedger(noteHolders);
    const sha256 = await keptIn(ledger, alpha, note, keptAt);
    await wrote(ledger, firstWritings, written({ body_sha256: sha256, body_bytes: threeMiB }));
    await wrote(ledger, firstWritings, written({ body_sha256: sha256, body_bytes: threeMiB }));

    await Effect.runPromise(ledger.scrubFact(firstWritings, 1, erasingWritten(1, { body: 'erased' })));
    const page = await pageOf(ledger);

    expect([page.records.map(({ type }) => type), page.hasMore]).toEqual([
      ['note_written', 'note_written', 'note_erased'],
      false,
    ]);
  });
}

function refusedUnheld(entry: UnheldContentEntry): void {
  it("refuses, and records nothing, a fact that names a payload the playbook's content does not keep", async () => {
    const ledger = await entry.aLedger(noteHolders);
    const never = sha256Of('never kept');

    const refused = wrote(ledger, firstWritings, written({ body_sha256: never, body_bytes: 10 }));

    await expect(refused).rejects.toThrow(
      `A fact names the payload ${never} of playbook/acme/alpha/, which the playbook's content does not keep`,
    );
    expect(await versionOf(ledger, firstWritings)).toBe(0);
  });

  it("records a fact of an org's stream that names a payload, which holds nothing, since only a playbook's streams hold content", async () => {
    const ledger = await entry.aLedger(noteHolders);

    await wrote(ledger, writingsOfTheOrg, written({ body_sha256: sha256Of('never kept'), body_bytes: 10 }));

    expect(await versionOf(ledger, writingsOfTheOrg)).toBe(1);
  });

  it('refuses, and records nothing, a fact that keeps a payload outside where the ledger was opened without its declaration, which would hold none of it; the same fact inline is recorded', async () => {
    const ledger = await entry.aLedger(withoutWrittenNotes);
    const sha256 = await keptIn(ledger, alpha, note, keptAt);

    const refused = wrote(ledger, firstWritings, written({ body_sha256: sha256, body_bytes: 20 }));
    await expect(refused).rejects.toThrow(
      `A fact note_written of ${firstWritings} keeps 20 bytes of payloads outside by its schema, where the ledger's holders count 0, so the ledger would not hold them`,
    );
    await wrote(ledger, firstWritings, written({ body: note }));

    expect(await versionOf(ledger, firstWritings)).toBe(1);
    expect(await removedAt(ledger, keptAt + 2 * anHour, alpha, sha256)).toBe('removed');
  });
}

export function payloadHoldsBehaviour(entry: UnheldContentEntry): void {
  describe('the facts that keep payloads outside, measured whole and held only where the content is kept', () => {
    measuredByTheirPayloads(entry);
    refusedUnheld(entry);
  });
}
