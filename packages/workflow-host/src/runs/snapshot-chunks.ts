import { statement } from '@on.auto/ledger';
import {
  UnreadableRun,
  snapshotChunks,
  snapshotFromChunks,
  type Snapshot,
  type StoredSnapshot,
} from '@on.auto/workflow-engine';
import { Effect, Result, Schema } from 'effect';

import { rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

const ChunkRow = Schema.Struct({ version: WholeNumber, chunks: WholeNumber, bytes: WholeNumber, text: Schema.String });

const VersionRow = Schema.Struct({ version: WholeNumber, present: WholeNumber, chunks: WholeNumber });

type Chunk = typeof ChunkRow.Type;

const utf8 = new TextEncoder();

function completeVersions(rows: readonly (typeof VersionRow.Type)[]): readonly number[] {
  return rows.filter(({ present, chunks }) => present === chunks).map(({ version }) => version);
}

function latestCompleteVersion(database: HostDatabase, runKey: string): Effect.Effect<number, DatabaseFailed> {
  return rowsOf(
    VersionRow,
    database.read(
      statement`SELECT version, COUNT(*) AS present, MAX(chunks) AS chunks
        FROM workflow_snapshot_chunks WHERE run_key = ${runKey} GROUP BY version`,
    ),
  ).pipe(Effect.map((rows) => Math.max(0, ...completeVersions(rows))));
}

function storedSnapshotOf(chunks: readonly Chunk[]): StoredSnapshot {
  const decoded = snapshotFromChunks(chunks.map(({ text }) => text));
  if (Result.isFailure(decoded)) {
    throw new UnreadableRun({ detail: `A snapshot of the run does not decode: ${String(decoded.failure)}` });
  }
  return { snapshot: decoded.success, bytes: chunks.reduce((sum, { bytes }) => sum + bytes, 0) };
}

export function latestSnapshotOf(database: HostDatabase, runKey: string): Effect.Effect<StoredSnapshot | null> {
  return Effect.orDie(
    Effect.gen(function* () {
      const version = yield* latestCompleteVersion(database, runKey);
      if (version === 0) {
        return null;
      }
      const chunks = yield* rowsOf(
        ChunkRow,
        database.read(
          statement`SELECT version, chunks, bytes, text FROM workflow_snapshot_chunks
            WHERE run_key = ${runKey} AND version = ${version} ORDER BY chunk`,
        ),
      );
      return storedSnapshotOf(chunks);
    }),
  );
}

export function savedSnapshot(database: HostDatabase, snapshot: Snapshot): Effect.Effect<void> {
  const { runId: runKey, version } = snapshot;
  return Effect.orDie(
    Effect.gen(function* () {
      if ((yield* latestCompleteVersion(database, runKey)) >= version) {
        return;
      }
      const chunks = snapshotChunks(snapshot);
      yield* Effect.forEach(
        chunks,
        (text, chunk) =>
          database.write(
            statement`INSERT INTO workflow_snapshot_chunks (run_key, version, chunk, chunks, bytes, text)
              VALUES (${runKey}, ${version}, ${chunk}, ${chunks.length}, ${utf8.encode(text).byteLength}, ${text})
              ON CONFLICT (run_key, version, chunk) DO NOTHING`,
          ),
        { discard: true },
      );
      yield* database.write(
        statement`DELETE FROM workflow_snapshot_chunks WHERE run_key = ${runKey} AND version <> ${version}`,
      );
    }),
  );
}
