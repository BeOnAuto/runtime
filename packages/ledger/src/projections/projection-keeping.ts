import {
  addressedStreamOf,
  advancedColumnsLeftBy,
  contextOf,
  messageIdOf,
  rowKeyOf,
  type Context,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectedRow,
} from '@on.auto/operations';

import type { StatementExecutor } from '../event-store.ts';
import {
  inlineRegistrationOf,
  inTurn,
  type InlineProjection,
  type InlineRegistration,
  type StoredMessage,
} from './inline-projection.ts';
import type { ProjectionDialect } from './projection-dialect.ts';
import { rowIn, rowsLocked, rowsWrite, type RowPlace } from './projection-statements.ts';

export interface ProjectionKeeping {
  readonly dialect: ProjectionDialect;
  readonly projection: KeyedProjection;
}

export interface ReplayedMessage {
  readonly stream: string;
  readonly type: string;
  readonly data: unknown;
  readonly metadata: unknown;
  readonly position: number;
}

function projectedOf({ type, data, context, id, position }: StoredMessage): ProjectedMessage {
  return { id, position, type, data, context };
}

async function keptAfter(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  place: RowPlace,
  message: StoredMessage,
): Promise<void> {
  const stored = await rowIn(execute, dialect, projection, place);
  const row = projection.rowAfter(stored, projectedOf(message));
  if (row !== undefined) {
    const standing = stored === undefined ? [] : advancedColumnsLeftBy(projection, message.type);
    await execute.command(rowsWrite(dialect, projection, [{ ...place, row }], standing));
  }
}

function placeOf(projection: KeyedProjection, message: StoredMessage): RowPlace | undefined {
  const named = addressedStreamOf(message.stream);
  const key = named === undefined ? undefined : rowKeyOf(projection, projectedOf(message), named);
  return named === undefined || key === undefined ? undefined : { prefix: named.prefix, key };
}

interface PlacedMessage {
  readonly message: StoredMessage;
  readonly place: RowPlace;
}

function placedOf({ dialect, projection }: ProjectionKeeping, messages: readonly StoredMessage[]) {
  return messages.flatMap((message): readonly PlacedMessage[] => {
    const decoded = { ...message, data: dialect.appendedData(message.data) };
    const place = placeOf(projection, decoded);
    return place === undefined ? [] : [{ message: decoded, place }];
  });
}

function keepingProjection(keeping: ProjectionKeeping): InlineProjection {
  return {
    types: keeping.projection.types,
    handle: async (messages, execute) => {
      const placed = placedOf(keeping, messages);
      await rowsLocked(
        execute,
        keeping.dialect,
        keeping.projection,
        placed.map(({ place }) => place),
      );
      await inTurn(placed, ({ message, place }: PlacedMessage) => keptAfter(keeping, execute, place, message));
    },
  };
}

export function filledMessageOf(
  { dialect }: Pick<ProjectionKeeping, 'dialect'>,
  { stream, type, data, metadata, position }: ReplayedMessage,
): ProjectedMessage {
  const context: Context = contextOf(dialect.filledMetadata(metadata));
  return { id: messageIdOf(stream, position), position, type, data: dialect.filledData(data), context };
}

export function rowFoldedOver(
  { rowAfter }: KeyedProjection,
  messages: readonly ProjectedMessage[],
  from?: ProjectedRow,
): ProjectedRow | undefined {
  let row = from;
  for (const message of messages) {
    row = rowAfter(row, message) ?? row;
  }
  return row;
}

export function replayedRow(
  keeping: ProjectionKeeping,
  messages: readonly ReplayedMessage[],
  from?: ProjectedRow,
): ProjectedRow | undefined {
  return rowFoldedOver(
    keeping.projection,
    messages.map((message) => filledMessageOf(keeping, message)),
    from,
  );
}

export function projectionRegistrations(
  dialect: ProjectionDialect,
  projections: readonly KeyedProjection[],
): readonly InlineRegistration[] {
  return projections.map((projection) => inlineRegistrationOf(keepingProjection({ dialect, projection })));
}
