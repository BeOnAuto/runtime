import { contextOf, messageIdOf, typesOf } from '@on.auto/operations';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import type { StoredMessage } from '../projections/inline-projection.ts';
import { batchesFilledFrom, listingAfter, messagesInABatch, withinBytes } from '../projections/projection-fill.ts';
import { foldedIntoItsTables, type StreamKeeping } from './stream-folds.ts';
import {
  checkpointLocked,
  checkpointWritten,
  messagesThrough,
  sizesAfter,
  type StreamMessage,
  type StreamPlace,
} from './stream-statements.ts';

export interface CatchUpKeeping extends StreamKeeping {
  readonly mostBytes: number;
}

export interface Built {
  readonly stream: string;
  readonly from: number;
  readonly through: number;
  readonly facts: number;
  readonly bytes: number;
  readonly pages: number;
  readonly ms: number;
}

interface Page {
  readonly listing: number;
}

interface PageRead {
  readonly facts: number;
  readonly bytes: number;
  readonly through: number;
  readonly next: Page | undefined;
}

function storedOf(
  { dialect }: CatchUpKeeping,
  { stream, type, data, metadata, position }: StreamMessage,
): StoredMessage {
  return {
    stream,
    type,
    data: dialect.filledData(data),
    context: contextOf(dialect.filledMetadata(metadata)),
    id: messageIdOf(stream, position),
    position,
  };
}

async function pageCaughtUp(
  keeping: CatchUpKeeping,
  execute: StatementExecutor,
  place: StreamPlace,
  { listing }: Page,
): Promise<PageRead | undefined> {
  const { dialect, projection, mostBytes } = keeping;
  const stream = `${place.prefix}${place.stream}`;
  const after = await checkpointLocked(execute, dialect, projection, place);
  const listed = await sizesAfter(execute, dialect, stream, { after, count: listing });
  const taken = withinBytes(listed, mostBytes);
  const last = taken.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const folded = new Set(typesOf(projection));
  const read = await messagesThrough(execute, stream, { after, through: last.position });
  await foldedIntoItsTables(
    keeping,
    execute,
    read.filter(({ type }) => folded.has(type)).map((message) => storedOf(keeping, message)),
  );
  await execute.command(checkpointWritten(projection, place, last.position));
  const more = taken.length < listed.length || listed.length === listing;
  return {
    facts: read.length,
    bytes: taken.reduce((total, { size }) => total + size, 0),
    through: last.position,
    next: more ? { listing: listingAfter({ listing, most: messagesInABatch, mostBytes }, taken) } : undefined,
  };
}

export async function caughtUp(
  keeping: CatchUpKeeping,
  inTransaction: InTransaction,
  { place, from }: { readonly place: StreamPlace; readonly from: number },
): Promise<Built> {
  const began = performance.now();
  let [facts, bytes, pages, through] = [0, 0, 0, from];
  await batchesFilledFrom<Page>({ listing: 1 }, async (page) => {
    const read = await inTransaction((execute) => pageCaughtUp(keeping, execute, place, page));
    if (read !== undefined) {
      [facts, bytes, pages, through] = [facts + read.facts, bytes + read.bytes, pages + 1, read.through];
    }
    return read?.next;
  });
  return {
    stream: `${place.prefix}${place.stream}`,
    from,
    through,
    facts,
    bytes,
    pages,
    ms: Math.round(performance.now() - began),
  };
}
