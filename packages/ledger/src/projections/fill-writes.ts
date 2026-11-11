import { addressedStreamOf, keepsChildRows } from '@on.auto/operations';

import { childRowsInAWrite, childRowsOf, childRowsWrite } from '../child-rows/child-row-statements.ts';
import { chunksOf } from '../connection/bound-values.ts';
import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from './inline-projection.ts';
import { replayedChildRows, replayedRow, type ProjectionKeeping, type ReplayedMessage } from './projection-keeping.ts';
import { rowsWrite, type KeptRow, type RowPlace } from './projection-statements.ts';

export function writtenInChunks(keeping: ProjectionKeeping, execute: StatementExecutor, kept: readonly KeptRow[]) {
  const { dialect, projection } = keeping;
  return inTurn(chunksOf(kept, dialect.rowsInAWrite(projection.columns.length)), (rows) =>
    execute.command(rowsWrite(dialect, projection, rows)),
  );
}

type Replayed<Folded> = (messages: readonly ReplayedMessage[]) => Folded | undefined;

function replayedOfStreams<Folded>(
  streams: readonly string[],
  messages: readonly ReplayedMessage[],
  replayed: Replayed<Folded>,
): readonly (RowPlace & { readonly folded: Folded })[] {
  const byStream = Map.groupBy(messages, ({ stream }) => stream);
  return streams.flatMap((stream) => {
    const named = addressedStreamOf(stream);
    const folded = named === undefined ? undefined : replayed(byStream.get(stream) ?? []);
    return named === undefined || folded === undefined ? [] : [{ prefix: named.prefix, key: named.id, folded }];
  });
}

export function writtenOfStreams(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  streams: readonly string[],
  messages: readonly ReplayedMessage[],
): Promise<void> {
  if (keepsChildRows(projection)) {
    const keeping = { dialect, projection };
    const replayed = replayedOfStreams(streams, messages, (each) => replayedChildRows(keeping, each));
    return inTurn(
      chunksOf(
        replayed.flatMap(({ prefix, key, folded }) => childRowsOf({ prefix, key, rows: folded })),
        childRowsInAWrite(dialect, projection),
      ),
      (rows) => execute.command(childRowsWrite(dialect, projection, rows)),
    );
  }
  const keeping = { dialect, projection };
  const replayed = replayedOfStreams(streams, messages, (each) => replayedRow(keeping, each));
  return writtenInChunks(
    keeping,
    execute,
    replayed.map(({ prefix, key, folded }) => ({ prefix, key, row: folded })),
  );
}
