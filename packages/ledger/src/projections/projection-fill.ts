import {
  addressedStreamOf,
  projectedTableOf,
  rowKeyOf,
  type KeyedProjection,
  type ProjectedRow,
} from '@on.auto/operations';

import { chunksOf } from '../connection/bound-values.ts';
import type { InTransaction, StatementExecutor } from '../event-store.ts';
import { inTurn } from './inline-projection.ts';
import { foldedStreamsOf } from './projection-dialect.ts';
import { filledMessageOf, replayedRow, type ProjectionKeeping, type ReplayedMessage } from './projection-keeping.ts';
import {
  createdTable,
  messagesIn,
  namesIn,
  orderedMessagesIn,
  rowIn,
  rowsWrite,
  sizedPointsIn,
  streamsIn,
  tableAnalysis,
  tableDrop,
  type KeptRow,
  type RowPlace,
  type SizedStream,
} from './projection-statements.ts';

const streamsInABatch = 100;

export const messagesInABatch = 256;

export const mostBytesInABatch = 16 * 1024 * 1024;

interface FillKeeping extends ProjectionKeeping {
  readonly mostBytes: number;
}

export type NamedProjection = Pick<KeyedProjection, 'name'>;

const versionDigits = /^\d+$/u;

export function versionOfTable({ name }: NamedProjection, table: string): number | undefined {
  const versioned = `${name}_`;
  const version = table.startsWith(versioned) ? table.slice(versioned.length) : '';
  return versionDigits.test(version) ? Number(version) : undefined;
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
    const named = addressedStreamOf(stream);
    const row = named === undefined ? undefined : replayedRow(keeping, byStream.get(stream) ?? []);
    return named === undefined || row === undefined ? [] : [{ prefix: named.prefix, key: named.id, row }];
  });
}

export function withinBytes<Sized extends { readonly size: number }>(
  listed: readonly Sized[],
  mostBytes: number,
): readonly Sized[] {
  const taken: Sized[] = [];
  let loaded = 0;
  for (const sized of listed) {
    if (taken.length > 0 && loaded + sized.size > mostBytes) {
      return taken;
    }
    taken.push(sized);
    loaded += sized.size;
  }
  return taken;
}

export interface Listing {
  readonly listing: number;
  readonly most: number;
  readonly mostBytes: number;
}

export function listingAfter(
  { listing, most, mostBytes }: Listing,
  taken: readonly { readonly size: number }[],
): number {
  const takenBytes = taken.reduce((total, { size }) => total + size, 0);
  const fitting = Math.floor((mostBytes * taken.length) / takenBytes);
  return Math.max(1, Math.min(most, 2 * listing, fitting));
}

export async function batchesFilledFrom<Start>(
  start: Start,
  fillOne: (start: Start) => Promise<Start | undefined>,
): Promise<void> {
  const next = await fillOne(start);
  if (next !== undefined) {
    await batchesFilledFrom(next, fillOne);
  }
}

interface Batch {
  readonly after: string;
  readonly listing: number;
}

function batchAfter(
  { listing }: Batch,
  listed: readonly SizedStream[],
  taken: readonly string[],
  mostBytes: number,
): Batch | undefined {
  const last = taken.at(-1);
  if (last === undefined || (taken.length === listed.length && listed.length < listing)) {
    return undefined;
  }
  return {
    after: last,
    listing: listingAfter({ listing, most: streamsInABatch, mostBytes }, listed.slice(0, taken.length)),
  };
}

async function batchFilled(keeping: FillKeeping, execute: StatementExecutor, batch: Batch): Promise<Batch | undefined> {
  const { dialect, projection } = keeping;
  const listed = await streamsIn(
    execute,
    dialect.streamsAfter(batch.after, batch.listing, foldedStreamsOf(projection), projection.types),
  );
  const streams = withinBytes(listed, keeping.mostBytes).map(({ stream }) => stream);
  const messages = streams.length === 0 ? [] : await messagesIn(execute, dialect.messagesOf(streams, projection.types));
  await writtenInChunks(keeping, execute, replayedRows(keeping, streams, messages));
  return batchAfter(batch, listed, streams, keeping.mostBytes);
}

type Ordered = Awaited<ReturnType<typeof orderedMessagesIn>>[number];

interface PlacedMessage {
  readonly message: Ordered;
  readonly place: RowPlace;
  readonly stored: string;
}

function placedMessages(keeping: ProjectionKeeping, messages: readonly Ordered[]) {
  return messages.flatMap((message): readonly PlacedMessage[] => {
    const named = addressedStreamOf(message.stream);
    const key =
      named === undefined ? undefined : rowKeyOf(keeping.projection, filledMessageOf(keeping, message), named);
    return named === undefined || key === undefined
      ? []
      : [{ message, place: { prefix: named.prefix, key }, stored: `${named.prefix}${key}` }];
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

interface OrderBatch {
  readonly after?: string;
  readonly listing: number;
}

async function batchFilledInOrder(
  keeping: FillKeeping,
  execute: StatementExecutor,
  { after, listing }: OrderBatch,
): Promise<OrderBatch | undefined> {
  const { dialect, projection } = keeping;
  const streams = { of: 'folded', folded: foldedStreamsOf(projection) } as const;
  const listed = await sizedPointsIn(execute, dialect.sizesInOrderAfter(after, listing, streams, projection.types));
  const taken = withinBytes(listed, keeping.mostBytes);
  const through = taken.at(-1);
  const messages =
    through === undefined
      ? []
      : await orderedMessagesIn(
          execute,
          dialect.messagesInOrderThrough(after, through.point, streams, projection.types),
        );
  await writtenInChunks(keeping, execute, await keyedRowsAfter(keeping, execute, messages));
  const last = messages.at(-1);
  return last !== undefined && (taken.length < listed.length || listed.length === listing)
    ? {
        after: last.point,
        listing: listingAfter({ listing, most: messagesInABatch, mostBytes: keeping.mostBytes }, taken),
      }
    : undefined;
}

function filled(keeping: FillKeeping, execute: StatementExecutor): Promise<void> {
  return keeping.projection.keyOf === undefined
    ? batchesFilledFrom<Batch>({ after: '', listing: 1 }, (batch) => batchFilled(keeping, execute, batch))
    : batchesFilledFrom<OrderBatch>({ listing: 1 }, (batch) => batchFilledInOrder(keeping, execute, batch));
}

async function created(keeping: FillKeeping, execute: StatementExecutor, tables: readonly string[]): Promise<void> {
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
  keeping: FillKeeping,
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
  mostBytes: number = mostBytesInABatch,
): Promise<void> {
  await inTurn(keepings, (keeping) => preparedProjection({ ...keeping, mostBytes }, execute, inTransaction));
}
