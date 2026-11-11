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
  readonly place: StreamPlace;
  readonly messages: readonly StoredMessage[];
}

async function foldedContiguously(
  keeping: StreamKeeping,
  execute: StatementExecutor,
  { place, messages }: AppendedToAStream,
): Promise<void> {
  const { dialect, projection } = keeping;
  const positions = messages.map(({ position }) => position);
  const folded = await checkpointLocked(execute, dialect, projection, place);
  if (folded !== Math.min(...positions) - 1) {
    return;
  }
  await foldedIntoItsTables(
    keeping,
    execute,
    messages.map((message) => ({ ...message, data: dialect.appendedData(message.data) })),
  );
  await execute.command(checkpointWritten(projection, place, Math.max(...positions)));
}

function appendedToItsStreams(
  projection: StreamProjection,
  messages: readonly StoredMessage[],
): readonly AppendedToAStream[] {
  return [...Map.groupBy(messages, ({ stream }) => stream)].flatMap(
    ([stream, ofTheStream]: readonly [string, readonly StoredMessage[]]) => {
      const place = placeOfItsStream(projection, stream);
      return place === undefined ? [] : [{ place, messages: ofTheStream }];
    },
  );
}

export function contiguousFoldOf(keeping: StreamKeeping): InlineRegistration {
  return inlineRegistrationOf({
    types: typesOf(keeping.projection),
    handle: (messages, execute) =>
      inTurn(appendedToItsStreams(keeping.projection, messages), (appended) =>
        foldedContiguously(keeping, execute, appended),
      ),
  });
}
