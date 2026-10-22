import { runTallies, runTallyRows, topicRows } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { queried } from '../recorded/sqlite-checks.ts';
import { ledgerLayer } from '../sqlite3.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { ledgerLayout } from './ledger-layout.ts';

const pinned = {
  layout: 1,
  catalog: [
    {
      name: 'kept_secrets',
      sql: 'CREATE TABLE kept_secrets (id TEXT PRIMARY KEY, version INTEGER NOT NULL, kept_at TEXT NOT NULL, claimed_until TEXT, ends_with TEXT, kept_by TEXT NOT NULL, held TEXT NOT NULL, wrapped_key TEXT, kid TEXT)',
    },
    {
      name: 'ledger_definition_streams',
      sql: "CREATE INDEX ledger_definition_streams ON emt_streams (CASE WHEN substr(stream_id, length(substr(stream_id, 1, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + instr(substr(stream_id, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + 1), '/'))) + 1, 12) = 'definitions/' THEN substr(stream_id, length(substr(stream_id, 1, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + instr(substr(stream_id, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + 1), '/'))) + 13) END) WHERE CASE WHEN substr(stream_id, length(substr(stream_id, 1, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + instr(substr(stream_id, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + 1), '/'))) + 1, 12) = 'definitions/' THEN substr(stream_id, length(substr(stream_id, 1, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + instr(substr(stream_id, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + 1), '/'))) + 13) END IS NOT NULL",
    },
    {
      name: 'ledger_first_messages_by_kind',
      sql: "CREATE INDEX ledger_first_messages_by_kind ON emt_messages (substr(stream_id, 1, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + instr(substr(stream_id, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + 1), '/') + instr(substr(stream_id, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + instr(substr(stream_id, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + 1), '/') + 1), '/')), global_position) WHERE stream_position = 1",
    },
    { name: 'ledger_messages_by_id', sql: 'CREATE INDEX ledger_messages_by_id ON emt_messages (message_id)' },
    {
      name: 'ledger_messages_by_playbook',
      sql: "CREATE INDEX ledger_messages_by_playbook ON emt_messages (substr(stream_id, 1, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + instr(substr(stream_id, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + 1), '/')), global_position)",
    },
    {
      name: 'ledger_messages_by_playbook_and_correlation',
      sql: "CREATE INDEX ledger_messages_by_playbook_and_correlation ON emt_messages (substr(stream_id, 1, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + instr(substr(stream_id, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + 1), '/')), json_extract(message_metadata, '$.correlationId'), global_position)",
    },
    {
      name: 'ledger_messages_by_playbook_and_time',
      sql: "CREATE INDEX ledger_messages_by_playbook_and_time ON emt_messages (substr(stream_id, 1, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + instr(substr(stream_id, instr(stream_id, '/') + instr(substr(stream_id, instr(stream_id, '/') + 1), '/') + 1), '/')), created)",
    },
    {
      name: 'ledger_messages_by_stream',
      sql: 'CREATE INDEX ledger_messages_by_stream ON emt_messages (stream_id, global_position)',
    },
    {
      name: 'recorded_content_chunks',
      sql: 'CREATE TABLE recorded_content_chunks (playbook_key TEXT NOT NULL, upload_id TEXT NOT NULL, chunk INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (playbook_key, upload_id, chunk))',
    },
    {
      name: 'recorded_content_heads',
      sql: 'CREATE TABLE recorded_content_heads (playbook_key TEXT NOT NULL, sha256 TEXT NOT NULL, upload_id TEXT NOT NULL, bytes BIGINT NOT NULL, chunks INTEGER NOT NULL, media_type TEXT NOT NULL, PRIMARY KEY (playbook_key, sha256))',
    },
    {
      name: 'recorded_content_heads_by_upload',
      sql: 'CREATE INDEX recorded_content_heads_by_upload ON recorded_content_heads (playbook_key, upload_id)',
    },
    {
      name: 'run_outcomes_4',
      sql: 'CREATE TABLE run_outcomes_4 (playbook_key TEXT NOT NULL, row_key TEXT NOT NULL, started_day TEXT, started_at TEXT, last_started_at TEXT, definition_type TEXT, name TEXT, status TEXT, duration_ms INTEGER, input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER, PRIMARY KEY (playbook_key, row_key))',
    },
    {
      name: 'run_outcomes_4_by_playbook_and_day',
      sql: 'CREATE INDEX run_outcomes_4_by_playbook_and_day ON run_outcomes_4 (playbook_key, started_day)',
    },
    {
      name: 'run_tallies_2',
      sql: 'CREATE TABLE run_tallies_2 (playbook_key TEXT NOT NULL, row_key TEXT NOT NULL, fn TEXT, began_at INTEGER, status TEXT, facts INTEGER, open INTEGER, due_at INTEGER, last_message TEXT, PRIMARY KEY (playbook_key, row_key))',
    },
    {
      name: 'run_tallies_2_by_playbook_and_status',
      sql: 'CREATE INDEX run_tallies_2_by_playbook_and_status ON run_tallies_2 (playbook_key, status, began_at)',
    },
    {
      name: 'run_tallies_2_due',
      sql: 'CREATE INDEX run_tallies_2_due ON run_tallies_2 (due_at) WHERE due_at IS NOT NULL',
    },
    {
      name: 'staged_content',
      sql: 'CREATE TABLE staged_content (playbook_key TEXT NOT NULL, run_id TEXT NOT NULL, sha256 TEXT NOT NULL, upload_id TEXT NOT NULL, bytes BIGINT NOT NULL, chunks INTEGER NOT NULL, media_type TEXT NOT NULL, PRIMARY KEY (playbook_key, run_id, sha256))',
    },
    {
      name: 'staged_content_by_upload',
      sql: 'CREATE INDEX staged_content_by_upload ON staged_content (playbook_key, run_id, upload_id)',
    },
    {
      name: 'staged_content_chunks',
      sql: 'CREATE TABLE staged_content_chunks (playbook_key TEXT NOT NULL, run_id TEXT NOT NULL, upload_id TEXT NOT NULL, chunk INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (playbook_key, run_id, upload_id, chunk))',
    },
    {
      name: 'topics_2',
      sql: 'CREATE TABLE topics_2 (playbook_key TEXT NOT NULL, row_key TEXT NOT NULL, topic TEXT, note TEXT, last_message TEXT, open INTEGER, next_at INTEGER, due_at INTEGER, PRIMARY KEY (playbook_key, row_key))',
    },
    { name: 'topics_2_due', sql: 'CREATE INDEX topics_2_due ON topics_2 (due_at) WHERE due_at IS NOT NULL' },
    {
      name: 'unstaged_runs',
      sql: 'CREATE TABLE unstaged_runs (playbook_key TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY (playbook_key, run_id))',
    },
  ],
};

const theLedgersOwnRelations = `SELECT name, sql FROM sqlite_master
  WHERE type IN ('table', 'index') AND name NOT GLOB 'emt_*' AND name NOT GLOB 'dmb_*' AND name NOT GLOB 'sqlite_*'
  ORDER BY name`;

function onOneLine(sql: string): string {
  return sql.replaceAll(/\s+/gu, ' ').replaceAll('( ', '(').replaceAll(' )', ')');
}

const CatalogRows = Schema.Array(Schema.Struct({ name: Schema.String, sql: Schema.String }));

async function catalogOfANewLedger(): Promise<readonly { readonly name: string; readonly sql: string }[]> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const opened = await openLedgerWith(
    ledgerLayer({ fileName, runOutcomes: runTallies, projections: [runTallyRows, topicRows] }),
  );
  await opened.dispose();
  const rows = Schema.decodeUnknownSync(CatalogRows)(await queried(fileName, theLedgersOwnRelations));
  return rows.map(({ name, sql }) => ({ name, sql: onOneLine(sql) }));
}

describe('the layout of the ledger', () => {
  it('is the layout of the tables and indexes the ledger makes, pinned here', async () => {
    const catalog = await catalogOfANewLedger();

    expect(
      { layout: ledgerLayout, catalog },
      "The ledger's layout changed: raise ledgerLayout in src/layout/ledger-layout.ts, then pin here the layout and the catalog of every table and index the ledger makes",
    ).toEqual(pinned);
  });
});
