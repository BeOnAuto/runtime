import {
  keepsChildRows,
  type ChildRowsProjection,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectionDeclaration,
} from '@on.auto/operations';

import { childRowsIn, childRowsReplaced } from '../child-rows/child-row-statements.ts';
import type { StatementExecutor } from '../event-store.ts';
import { writtenInChunks } from './fill-writes.ts';
import { inTurn } from './inline-projection.ts';
import {
  childRowsFoldedOver,
  filledMessageOf,
  placedIn,
  replayedRow,
  type KeepingOf,
  type ProjectionKeeping,
} from './projection-keeping.ts';
import { rowIn, type KeptRow, type orderedMessagesIn, type RowPlace } from './projection-statements.ts';

export const messagesInABatch = 256;

export const mostBytesInABatch = 16 * 1024 * 1024;

export type NamedProjection = Pick<ProjectionDeclaration, 'name'>;

const versionDigits = /^\d+$/u;

export function versionOfTable({ name }: NamedProjection, table: string): number | undefined {
  const versioned = `${name}_`;
  const version = table.startsWith(versioned) ? table.slice(versioned.length) : '';
  return versionDigits.test(version) ? Number(version) : undefined;
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

type Ordered = Awaited<ReturnType<typeof orderedMessagesIn>>[number];

interface PlacedMessage {
  readonly message: Ordered;
  readonly place: RowPlace;
  readonly stored: string;
}

function placedMessages(keeping: ProjectionKeeping, messages: readonly Ordered[]): readonly PlacedMessage[] {
  return messages.flatMap((message) =>
    placedIn(keeping.projection, [{ ...filledMessageOf(keeping, message), stream: message.stream }]).map(
      ({ place }) => ({ message, place, stored: `${place.prefix}${place.key}` }),
    ),
  );
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

export function keptInOrder(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  messages: readonly Ordered[],
): Promise<void> {
  return keepsChildRows(projection)
    ? keyedChildRowsAfter({ dialect, projection }, execute, messages)
    : keyedRowsAfter({ dialect, projection }, execute, messages);
}
