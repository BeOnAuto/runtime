import { Schema } from 'effect';
import { expect, it, onTestFinished } from 'vitest';

import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { archivedBySQL, archivedRun, ofTheRuns, writtenTo } from './archived-streams.ts';

export interface AppendedToAnArchivedName {
  readonly answered: unknown;
  readonly read: { readonly version: number; readonly types: readonly string[] };
  readonly rows: readonly { readonly archived: number; readonly facts: number }[];
}

const MarkRows = Schema.Array(Schema.Struct({ archived: Schema.Number, facts: Schema.Number }));

export function archivedAppendBehaviour(entry: LedgerEntry, expected: AppendedToAnArchivedName): void {
  it('meets an append to the name of an archived stream, at the version a read of it gives, as the event store library answers it on this store', async () => {
    const database = await entry.aDatabase();
    const store = entry.storeOn(database);
    onTestFinished(() => store.close());
    await store.migrate();
    await writtenTo(store, [archivedRun]);
    await archivedBySQL(entry, database, [archivedRun.stream]);

    const { version } = await store.read(archivedRun.stream);
    const answered = await store
      .append(archivedRun.stream, [{ type: 'run_began', data: { at: ofTheRuns.at, fn: 'triage' } }], {
        expectedVersion: version,
        context: ofTheRuns,
      })
      .catch((error: unknown) => error);
    const read = await store.read(archivedRun.stream);
    const rows = await entry.queried(
      database,
      `SELECT CAST(is_archived AS INTEGER) AS archived, CAST(count(*) AS INTEGER) AS facts FROM emt_messages
        WHERE stream_id = '${archivedRun.stream}' GROUP BY is_archived ORDER BY is_archived`,
    );

    expect({
      answered,
      read: { version: read.version, types: read.messages.map(({ type }) => type) },
      rows: Schema.decodeUnknownSync(MarkRows)(rows),
    }).toEqual(expected);
  });
}
