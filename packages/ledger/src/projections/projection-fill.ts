import {
  addressedStreamOf,
  keepsChildRows,
  projectedTableOf,
  rowKeyOf,
  type ChildRowsProjection,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectionDeclaration,
} from '@on.auto/operations';

import { childRowsIn, childRowsReplaced } from '../child-rows/child-row-statements.ts';
import type { InTransaction, StatementExecutor } from '../event-store.ts';
import { writtenInChunks, writtenOfStreams } from './fill-writes.ts';
import { inTurn } from './inline-projection.ts';
import { foldedStreamsOf } from './projection-dialect.ts';
import {
  childRowsFoldedOver,
  filledMessageOf,
  replayedRow,
  type KeepingOf,
  type ProjectionKeeping,
} from './projection-keeping.ts';
import {
  createdTable,
  messagesIn,
  namesIn,
  orderedMessagesIn,
  rowIn,
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

export type NamedProjection = Pick<ProjectionDeclaration, 'name'>;

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
  await writtenOfStreams(keeping, execute, streams, messages);
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

async function rowsBefore<Kept>(
  placed: readonly PlacedMessage[],
  readOne: (place: RowPlace) => Promise<Kept>,
): Promise<ReadonlyMap<string, Kept>> {
  const places = new Map(placed.map(({ stored, place }) => [stored, place]));
  const before = new Map<string, Kept>();
  await inTurn([...places], async ([stored, place]: readonly [string, RowPlace]) => {
    before.set(stored, await readOne(place));
  });
  return before;
}

async function keyedRowsAfter(
  keeping: KeepingOf<KeyedProjection>,
  execute: StatementExecutor,
  messages: readonly Ordered[],
): Promise<void> {
  const { dialect, projection } = keeping;
  const placed = placedMessages(keeping, messages);
  const before = await rowsBefore(placed, (place) => rowIn(execute, dialect, projection, place));
  const changed = new Map<string, KeptRow>();
  for (const { message, place, stored } of placed) {
    const row = replayedRow(keeping, [message], changed.get(stored)?.row ?? before.get(stored));
    if (row !== undefined) {
      changed.set(stored, { ...place, row });
    }
  }
  await writtenInChunks(keeping, execute, [...changed.values()]);
}

interface MessagesOfAKey {
  readonly place: RowPlace;
  readonly messages: readonly ProjectedMessage[];
}

interface CollectedOfAKey extends MessagesOfAKey {
  readonly messages: ProjectedMessage[];
}

async function keyedChildRowsAfter(
  keeping: KeepingOf<ChildRowsProjection>,
  execute: StatementExecutor,
  messages: readonly Ordered[],
): Promise<void> {
  const { dialect, projection } = keeping;
  const keys = new Map<string, CollectedOfAKey>();
  for (const { message, place, stored } of placedMessages(keeping, messages)) {
    const ofTheKey = keys.get(stored) ?? { place, messages: [] };
    ofTheKey.messages.push(filledMessageOf(keeping, message));
    keys.set(stored, ofTheKey);
  }
  await inTurn([...keys.values()], async ({ place, messages: ofTheKey }: MessagesOfAKey) => {
    const before = await childRowsIn(execute, dialect, projection, place);
    await childRowsReplaced(keeping, execute, { ...place, rows: childRowsFoldedOver(projection, ofTheKey, before) });
  });
}

function keptInOrder(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  messages: readonly Ordered[],
): Promise<void> {
  return keepsChildRows(projection)
    ? keyedChildRowsAfter({ dialect, projection }, execute, messages)
    : keyedRowsAfter({ dialect, projection }, execute, messages);
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
  await keptInOrder(keeping, execute, messages);
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
