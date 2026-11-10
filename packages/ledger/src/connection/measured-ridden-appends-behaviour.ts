import { writtenNotes } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { eventAppenderWithOf } from '../event-appender.ts';
import { stamped } from '../testing/happenings.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import type { VersionConflict } from '../version-conflict.ts';

const firstWritings = 'playbook/acme/alpha/writings/w1';

const keptOutside = { type: 'note_written' as const, data: { body_sha256: 'a'.repeat(64), body_bytes: 4096 } };

const inline = { type: 'note_written' as const, data: { body: 'inline' } };

function appendedOrRefused(appending: Effect.Effect<void, VersionConflict>): Promise<string> {
  return Effect.runPromise(
    Effect.catchDefect(Effect.as(appending, 'appended'), (defect) => Effect.succeed(String(defect))),
  );
}

export function measuredRiddenAppendsBehaviour(entry: LedgerEntry): void {
  describe("an append of the connection, a workflow run log's among them", () => {
    it('measures each fact as every append does, so a fact that keeps a payload outside, which nothing on this path holds, is refused, and the same fact inline is appended', async () => {
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
  });
}
