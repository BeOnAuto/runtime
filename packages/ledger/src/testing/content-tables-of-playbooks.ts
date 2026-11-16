import { chunksOfPlaybooks, headsOfPlaybooks } from '../org-content/org-content-step.ts';
import type { LedgerEntry } from './ledger-entry.ts';

export async function contentTablesOfPlaybooks(entry: LedgerEntry, database: string): Promise<void> {
  await entry.queried(database, 'DROP TABLE recorded_content_heads');
  await entry.queried(database, 'DROP TABLE recorded_content_chunks');
  await entry.queried(database, 'DROP TABLE recorded_content_places');
  await entry.queried(database, 'DROP TABLE IF EXISTS content_references_2');
  await entry.executedOn(database, async (execute) => {
    await execute.command(headsOfPlaybooks);
    await execute.command(chunksOfPlaybooks(entry.layout));
  });
}
