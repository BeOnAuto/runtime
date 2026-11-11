import {
  addressedStreamOf,
  advancedColumnsOf,
  keepsChildRows,
  rowKeyOf,
  type AddressedStream,
  type ProjectedMessage,
  type ProjectedRow,
  type ProjectedRows,
  type ProjectionDeclaration,
} from '@on.auto/operations';

import { childRowsReplaced } from '../child-rows/child-row-statements.ts';
import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from './inline-projection.ts';
import type { MessageLane, StreamsInOrder } from './projection-dialect.ts';
import { messagesInABatch } from './projection-fill.ts';
import {
  childRowsFoldedOver,
  filledMessageOf,
  noRows,
  rowFoldedOver,
  type ProjectionKeeping,
  type ReplayedMessage,
} from './projection-keeping.ts';
import { orderedMessagesIn, rowDelete, rowsLocked, rowsWrite, type RowPlace } from './projection-statements.ts';

interface RewrittenFact {
  readonly stream: string;
  readonly before: ProjectedMessage;
  readonly after: ProjectedMessage;
}

interface RowOfStreams {
  readonly place: RowPlace;
  readonly lanes: readonly MessageLane[];
}

type OrderedMessage = Awaited<ReturnType<typeof orderedMessagesIn>>[number];

async function messagesInOrderAfter(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  lanes: readonly MessageLane[],
  after: string | undefined,
): Promise<readonly OrderedMessage[]> {
  const read: OrderedMessage[] = [];
  await inTurn(lanes, async (lane) => {
    const streams: StreamsInOrder = { of: 'lane', lane };
    read.push(
      ...(await orderedMessagesIn(
        execute,
        dialect.messagesInOrderAfter(after, messagesInABatch, streams, projection.types),
      )),
    );
  });
  return read
    .toSorted((left, right) => Number(left.ordered > right.ordered) - Number(left.ordered < right.ordered))
    .slice(0, messagesInABatch);
}

interface Folding<Folded> {
  readonly folded: Folded;
  readonly after?: string;
}

type FoldedOver<Folded> = (messages: readonly ProjectedMessage[], from: Folded) => Folded;

function lanesOfTheRow({ kinds, keyOf }: ProjectionDeclaration, { prefix, scope }: AddressedStream, key: string) {
  if (keyOf === undefined) {
    return kinds.map((kind): MessageLane => ({ by: 'stream', key: `${prefix}${kind}/${key}` }));
  }
  return scope === 'playbook'
    ? [{ by: 'prefix', key: prefix } satisfies MessageLane]
    : kinds.map((kind): MessageLane => ({ by: 'prefix', key: `${prefix}${kind}/` }));
}

function messagesOfTheRow(
  keeping: ProjectionKeeping,
  messages: readonly ReplayedMessage[],
  { prefix, key }: RowPlace,
): readonly ProjectedMessage[] {
  return messages.flatMap((message) => {
    const named = addressedStreamOf(message.stream);
    const projected = filledMessageOf(keeping, message);
    return named?.prefix === prefix && rowKeyOf(keeping.projection, projected, named) === key ? [projected] : [];
  });
}

async function foldedInOrder<Folded>(
  keeping: ProjectionKeeping,
  execute: StatementExecutor,
  { place, lanes, over }: RowOfStreams & { readonly over: FoldedOver<Folded> },
  { folded, after }: Folding<Folded>,
): Promise<Folded> {
  const messages = await messagesInOrderAfter(keeping, execute, lanes, after);
  const row = over(messagesOfTheRow(keeping, messages, place), folded);
  const last = messages.at(-1);
  return last !== undefined && messages.length === messagesInABatch
    ? foldedInOrder(keeping, execute, { place, lanes, over }, { folded: row, after: last.point })
    : row;
}

async function rowRefolded(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  named: AddressedStream,
  key: string,
): Promise<void> {
  const place = { prefix: named.prefix, key };
  const lanes = lanesOfTheRow(projection, named, key);
  if (keepsChildRows(projection)) {
    const keeping = { dialect, projection };
    const over: FoldedOver<ProjectedRows> = (messages, from) => childRowsFoldedOver(projection, messages, from);
    const rows = await foldedInOrder(keeping, execute, { place, lanes, over }, { folded: noRows });
    await childRowsReplaced(keeping, execute, { ...place, rows });
    return;
  }
  const over: FoldedOver<ProjectedRow | undefined> = (messages, from) => rowFoldedOver(projection, messages, from);
  const row = await foldedInOrder({ dialect, projection }, execute, { place, lanes, over }, { folded: undefined });
  await execute.command(
    row === undefined
      ? rowDelete(projection, place)
      : rowsWrite(dialect, projection, [{ ...place, row }], advancedColumnsOf(projection)),
  );
}

function keysOf({ projection }: ProjectionKeeping, { before, after }: RewrittenFact, named: AddressedStream) {
  const keys = new Set([rowKeyOf(projection, before, named), rowKeyOf(projection, after, named)]);
  return [...keys].filter((key) => key !== undefined);
}

export async function rowsRefolded(
  keepings: readonly ProjectionKeeping[],
  execute: StatementExecutor,
  rewritten: RewrittenFact,
): Promise<void> {
  const named = addressedStreamOf(rewritten.stream);
  if (named === undefined) {
    return;
  }
  await inTurn(
    keepings.filter(({ projection }) => projection.types.includes(rewritten.before.type)),
    async (keeping) => {
      const keys = keysOf(keeping, rewritten, named);
      const places = keys.map((key) => ({ prefix: named.prefix, key }));
      await rowsLocked(execute, keeping.dialect, keeping.projection, places);
      await inTurn(keys, (key) => rowRefolded(keeping, execute, named, key));
    },
  );
}
