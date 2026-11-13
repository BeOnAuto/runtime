import { sha256Of, textToKeep } from '@on.auto/content';
import { alpha, memoryContentStore, resultOf } from '@on.auto/content/testing';
import { noteHolders, writtenNotes } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { eventAppenderWithOf } from '../event-appender.ts';
import { stamped } from '../testing/happenings.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { openConnectionWith } from '../testing/open-ledger.ts';
import type { VersionConflict } from '../version-conflict.ts';

const firstWritings = 'playbook/acme/alpha/writings/w1';

const keptOutside = { type: 'note_written' as const, data: { body_sha256: 'a'.repeat(64), body_bytes: 4096 } };

const inline = { type: 'note_written' as const, data: { body: 'inline' } };

const body = 'b'.repeat(4096);

const keptBody = { type: 'note_written' as const, data: { body_sha256: sha256Of(body), body_bytes: 4096 } };

const HeldRows = Schema.Array(
  Schema.Struct({
    stream: Schema.String,
    sha256: Schema.String,
    held: Schema.Union([Schema.Finite, Schema.FiniteFromString]),
  }),
);

function appendedOrRefused(appending: Effect.Effect<void, VersionConflict>): Promise<string> {
  return Effect.runPromise(
    Effect.catchDefect(Effect.as(appending, 'appended'), (defect) => Effect.succeed(String(defect))),
  );
}

function heldIn(entry: LedgerEntry, database: string): Promise<typeof HeldRows.Type> {
  return entry
    .queried(database, 'SELECT stream, sha256, held FROM content_references_1 ORDER BY sha256')
    .then((rows) => Schema.decodeUnknownSync(HeldRows)(rows));
}

export function measuredRiddenAppendsBehaviour(entry: LedgerEntry): void {
  describe("an append of the connection, a workflow run log's among them", () => {
    it('measures each fact as every append does, so a fact that offloads a payload, which nothing on this path holds, is refused, and the same fact inline is appended', async () => {
      const opened = entry.openedOn(await entry.aDatabase());
      onTestFinished(() => opened.store.close());
      await opened.store.migrate();
      const append = eventAppenderWithOf(opened.connection, writtenNotes.eventSchema);
      const place = { expectedVersion: 0, context: stamped };

      const appended = [
        await appendedOrRefused(append(firstWritings, [keptOutside], place, [])),
        await appendedOrRefused(append(firstWritings, [inline], place, [])),
      ];

      expect(appended).toEqual([
        `Error: A fact note_written of ${firstWritings} keeps 4096 bytes of payloads outside by its schema, where the ledger's holders count 0, so the ledger would not hold them; the ledger must be opened with the schema of every fact that keeps a payload`,
        'appended',
      ]);
      expect((await opened.store.read(firstWritings)).messages.map(({ data }) => data)).toEqual([{ body: 'inline' }]);
    });

    it('holds, in its own transaction, a payload a fact keeps outside, where the ledger is opened with the schema of that fact, and refuses a fact naming a payload the playbook does not keep', async () => {
      const database = await entry.aDatabase();
      const open = await openConnectionWith(entry.ledgerOutsideOn(database, noteHolders, memoryContentStore()));
      onTestFinished(open.dispose);
      await resultOf(open.ledger.content.put(alpha, textToKeep(body, 'text/plain')));
      const append = eventAppenderWithOf(open.connection, writtenNotes.eventSchema);

      const appended = [
        await appendedOrRefused(append(firstWritings, [keptBody], { expectedVersion: 0, context: stamped }, [])),
        await appendedOrRefused(append(firstWritings, [keptOutside], { expectedVersion: 1, context: stamped }, [])),
      ];

      expect(appended).toEqual([
        'appended',
        `Error: A fact names the payload ${'a'.repeat(64)} of playbook/acme/alpha/, which the playbook's content does not keep; a payload is put before the fact that names it is appended`,
      ]);
      expect(await heldIn(entry, database)).toEqual([{ stream: 'writings/w1', sha256: sha256Of(body), held: 1 }]);
    });
  });
}
