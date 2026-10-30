import {
  playbookStreamOf,
  projectedTableOf,
  rowKeyOf,
  type KeyedProjection,
  type ProjectedRow,
} from '@on.auto/operations';

import { chunksOf } from '../connection/bound-values.ts';
import type { InTransaction, StatementExecutor } from '../event-store.ts';
import { inTurn } from './inline-projection.ts';
import { filledMessageOf, replayedRow, type ProjectionKeeping, type ReplayedMessage } from './projection-keeping.ts';
import {
  createdTable,
  messagesIn,
  namesIn,
  orderedMessagesIn,
  rowIn,
  rowsWrite,
  streamsIn,
  tableAnalysis,
  tableDrop,
  type KeptRow,
  type RowPlace,
  type SizedStream,
} from './projection-statements.ts';

const streamsInABatch = 100;

const messagesInABatch = 256;

const mostBytesInABatch = 16 * 1024 * 1024;

export type NamedProjection = Pick<KeyedProjection, 'name'>;

export function versionOfTable({ name }: NamedProjection, table: string): number | undefined {
  const version = new RegExp(`^${name}_(?<version>\\d+)$`, 'u').exec(table)?.groups?.['version'];
  return version === undefined ? undefined : Number(version);
}

function isEarlierVersion({ projection }: ProjectionKeeping, table: string): boolean {
  const version = versionOfTable(projection, table);
  return version !== undefined && version < projection.version;
}

function writtenInChunks(keeping: ProjectionKeeping, execute: StatementExecutor, kept: readonly KeptRow[]) {
  const { dialect, projection } = keeping;
  return inTurn(chunksOf(kept, dialect.rowsInAWrite(projection.columns.length)), (rows) =>
    execute.command(rowsWrite(dialect, projection, rows)),
  );
}

function replayedRows(
  keeping: ProjectionKeeping,
  streams: readonly string[],
  messages: readonly ReplayedMessage[],
): readonly KeptRow[] {
  const byStream = Map.groupBy(messages, ({ stream }) => stream);
  return streams.flatMap((stream) => {
    const named = playbookStreamOf(stream);
    const row = named === undefined ? undefined : replayedRow(keeping, byStream.get(stream) ?? []);
    return named === undefined || row === undefined ? [] : [{ playbookKey: named.playbookKey, key: named.id, row }];
  });
}

function withinBytes(listed: readonly SizedStream[]): readonly string[] {
  const taken: string[] = [];
  let loaded = 0;
  for (const { stream, size } of listed) {
    if (taken.length > 0 && loaded + size > mostBytesInABatch) {
      return taken;
    }
    taken.push(stream);
    loaded += size;
  }
  return taken;
}

interface Batch {
  readonly after: string;
  readonly listing: number;
}

function batchAfter({ listing }: Batch, listed: readonly SizedStream[], taken: readonly string[]): Batch | undefined {
  const last = taken.at(-1);
  if (last === undefined || (taken.length === listed.length && listed.length < listing)) {
    return undefined;
  }
  const takenBytes = listed.slice(0, taken.length).reduce((total, { size }) => total + size, 0);
  const fitting = Math.floor((mostBytesInABatch * taken.length) / takenBytes);
  return { after: last, listing: Math.max(1, Math.min(streamsInABatch, 2 * listing, fitting)) };
}

async function batchFilled(
  keeping: ProjectionKeeping,
  execute: StatementExecutor,
  batch: Batch,
): Promise<Batch | undefined> {
  const { dialect, projection } = keeping;
  const listed = await streamsIn(
    execute,
    dialect.streamsAfter(batch.after, batch.listing, projection.kinds, projection.types),
  );
  const streams = withinBytes(listed);
  const messages = streams.length === 0 ? [] : await messagesIn(execute, dialect.messagesOf(streams, projection.types));
  await writtenInChunks(keeping, execute, replayedRows(keeping, streams, messages));
  return batchAfter(batch, listed, streams);
}

async function filledByStream(keeping: ProjectionKeeping, execute: StatementExecutor, batch: Batch): Promise<void> {
  const next = await batchFilled(keeping, execute, batch);
  if (next !== undefined) {
    await filledByStream(keeping, execute, next);
  }
}

type Ordered = Awaited<ReturnType<typeof orderedMessagesIn>>[number];

interface PlacedMessage {
  readonly message: Ordered;
  readonly place: RowPlace;
  readonly stored: string;
}

function placedMessages(keeping: ProjectionKeeping, messages: readonly Ordered[]) {
  return messages.flatMap((message): readonly PlacedMessage[] => {
    const named = playbookStreamOf(message.stream);
    const key =
      named === undefined ? undefined : rowKeyOf(keeping.projection, filledMessageOf(keeping, message), named);
    return named === undefined || key === undefined
      ? []
      : [{ message, place: { playbookKey: named.playbookKey, key }, stored: `${named.playbookKey}${key}` }];
  });
}

async function rowsBefore(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  placed: readonly PlacedMessage[],
): Promise<ReadonlyMap<string, ProjectedRow | undefined>> {
  const places = new Map(placed.map(({ stored, place }) => [stored, place]));
  const before = new Map<string, ProjectedRow | undefined>();
  await inTurn([...places], async ([stored, place]: readonly [string, RowPlace]) => {
    before.set(stored, await rowIn(execute, dialect, projection, place));
  });
  return before;
}

async function keyedRowsAfter(
  keeping: ProjectionKeeping,
  execute: StatementExecutor,
  messages: readonly Ordered[],
): Promise<readonly KeptRow[]> {
  const placed = placedMessages(keeping, messages);
  const before = await rowsBefore(keeping, execute, placed);
  const changed = new Map<string, KeptRow>();
  for (const { message, place, stored } of placed) {
    const row = replayedRow(keeping, [message], changed.get(stored)?.row ?? before.get(stored));
    if (row !== undefined) {
      changed.set(stored, { ...place, row });
    }
  }
  return [...changed.values()];
}

async function filledInOrder(keeping: ProjectionKeeping, execute: StatementExecutor, after?: string): Promise<void> {
  const { dialect, projection } = keeping;
  const messages = await orderedMessagesIn(
    execute,
    dialect.messagesInOrderAfter(after, messagesInABatch, projection.kinds, projection.types),
  );
  await writtenInChunks(keeping, execute, await keyedRowsAfter(keeping, execute, messages));
  const last = messages.at(-1);
  if (last !== undefined && messages.length === messagesInABatch) {
    await filledInOrder(keeping, execute, last.point);
  }
}

function filled(keeping: ProjectionKeeping, execute: StatementExecutor): Promise<void> {
  return keeping.projection.keyOf === undefined
    ? filledByStream(keeping, execute, { after: '', listing: 1 })
    : filledInOrder(keeping, execute);
}

async function created(
  keeping: ProjectionKeeping,
  execute: StatementExecutor,
  tables: readonly string[],
): Promise<void> {
  const { dialect, projection } = keeping;
  await inTurn(createdTable(dialect, projection), (statement) => execute.command(statement));
  await filled(keeping, execute);
  await inTurn(
    tables.filter((name) => isEarlierVersion(keeping, name)),
    (name) => execute.command(tableDrop(name)),
  );
  await execute.command(tableAnalysis(projection));
}

async function preparedProjection(
  keeping: ProjectionKeeping,
  execute: StatementExecutor,
  inTransaction: InTransaction,
): Promise<void> {
  const tables = await namesIn(execute, keeping.dialect.tableVersions(keeping.projection.name));
  if (!tables.includes(projectedTableOf(keeping.projection))) {
    await inTransaction((transaction) => created(keeping, transaction, tables));
  }
}

export async function preparedProjections(
  keepings: readonly ProjectionKeeping[],
  execute: StatementExecutor,
  inTransaction: InTransaction,
): Promise<void> {
  await inTurn(keepings, (keeping) => preparedProjection(keeping, execute, inTransaction));
}
