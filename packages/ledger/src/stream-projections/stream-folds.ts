import { addressedStreamOf, typesOf, type StreamProjection } from '@on.auto/operations';

import type { StatementExecutor } from '../event-store.ts';
import {
  inlineRegistrationOf,
  inTurn,
  type InlineRegistration,
  type StoredMessage,
} from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { keptInTurn, placedIn } from '../projections/projection-keeping.ts';
import { checkpointLocked, checkpointWritten, type StreamPlace } from './stream-statements.ts';

export interface StreamKeeping {
  readonly dialect: ProjectionDialect;
  readonly projection: StreamProjection;
}

export function placeOfItsStream({ kind, streams }: StreamProjection, stream: string): StreamPlace | undefined {
  const named = addressedStreamOf(stream);
  return named?.scope === 'playbook' && named.kind === kind && streams.includes(named.id)
    ? { prefix: named.prefix, stream: `${kind}/${named.id}` }
    : undefined;
}

export function foldedIntoItsTables(
  { dialect, projection }: StreamKeeping,
  execute: StatementExecutor,
  messages: readonly StoredMessage[],
): Promise<void> {
  return inTurn(projection.tables, (table) =>
    keptInTurn(
      { dialect, projection: table },
      execute,
      placedIn(
        table,
        messages.filter(({ type }) => table.types.includes(type)),
      ),
    ),
  );
}

interface AppendedToAStream {
  readonly stream: string;
  readonly place: StreamPlace;
  readonly positions: readonly number[];
}

function appendedToItsStreams(
  projection: StreamProjection,
  messages: readonly StoredMessage[],
): readonly AppendedToAStream[] {
  return [...Map.groupBy(messages, ({ stream }) => stream)].flatMap(
    ([stream, ofTheStream]: readonly [string, readonly StoredMessage[]]) => {
      const place = placeOfItsStream(projection, stream);
      return place === undefined ? [] : [{ stream, place, positions: ofTheStream.map(({ position }) => position) }];
    },
  );
}

function byStreamName(one: AppendedToAStream, other: AppendedToAStream): number {
  return Number(one.stream > other.stream) - Number(one.stream < other.stream);
}

async function contiguousOf(
  { dialect, projection }: StreamKeeping,
  execute: StatementExecutor,
  appended: readonly AppendedToAStream[],
): Promise<readonly AppendedToAStream[]> {
  const contiguous: AppendedToAStream[] = [];
  await inTurn(appended.toSorted(byStreamName), async (ofAStream) => {
    const folded = await checkpointLocked(execute, dialect, projection, ofAStream.place);
    if (folded === Math.min(...ofAStream.positions) - 1) {
      contiguous.push(ofAStream);
    }
  });
  return contiguous;
}

async function foldedContiguously(
  keeping: StreamKeeping,
  execute: StatementExecutor,
  messages: readonly StoredMessage[],
): Promise<void> {
  const { dialect, projection } = keeping;
  const contiguous = await contiguousOf(keeping, execute, appendedToItsStreams(projection, messages));
  const folding = new Set(contiguous.map(({ stream }) => stream));
  await foldedIntoItsTables(
    keeping,
    execute,
    messages.flatMap((message) =>
      folding.has(message.stream) ? [{ ...message, data: dialect.appendedData(message.data) }] : [],
    ),
  );
  await inTurn(contiguous, ({ place, positions }) =>
    execute.command(checkpointWritten(projection, place, Math.max(...positions))),
  );
}

export function contiguousFoldOf(keeping: StreamKeeping): InlineRegistration {
  return inlineRegistrationOf({
    types: typesOf(keeping.projection),
    handle: (messages, execute) => foldedContiguously(keeping, execute, messages),
  });
}
