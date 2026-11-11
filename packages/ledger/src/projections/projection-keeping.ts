import {
  addressedStreamOf,
  advancedColumnsLeftBy,
  contextOf,
  keepsChildRows,
  messageIdOf,
  rowKeyOf,
  type ChildRowsProjection,
  type Context,
  type KeptProjection,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectedRow,
  type ProjectedRows,
} from '@on.auto/operations';

import { childRowsIn, childRowsReplaced } from '../child-rows/child-row-statements.ts';
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
  readonly projection: KeptProjection;
}

export interface KeepingOf<Projection extends KeptProjection> extends ProjectionKeeping {
  readonly projection: Projection;
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

async function rowKeptAfter(
  { dialect, projection }: KeepingOf<KeyedProjection>,
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

async function childRowsKeptAfter(
  keeping: KeepingOf<ChildRowsProjection>,
  execute: StatementExecutor,
  place: RowPlace,
  message: StoredMessage,
): Promise<void> {
  const { dialect, projection } = keeping;
  const rows = projection.rowsAfter(await childRowsIn(execute, dialect, projection, place), projectedOf(message));
  if (rows !== undefined) {
    await childRowsReplaced(keeping, execute, { ...place, rows });
  }
}

function keptAfter(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  place: RowPlace,
  message: StoredMessage,
): Promise<void> {
  return keepsChildRows(projection)
    ? childRowsKeptAfter({ dialect, projection }, execute, place, message)
    : rowKeptAfter({ dialect, projection }, execute, place, message);
}

function placeOf(projection: KeptProjection, message: StoredMessage): RowPlace | undefined {
  const named = addressedStreamOf(message.stream);
  const key = named === undefined ? undefined : rowKeyOf(projection, projectedOf(message), named);
  return named === undefined || key === undefined ? undefined : { prefix: named.prefix, key };
}

export interface PlacedMessage {
  readonly message: StoredMessage;
  readonly place: RowPlace;
}

export function placedIn(projection: KeptProjection, messages: readonly StoredMessage[]): readonly PlacedMessage[] {
  return messages.flatMap((message): readonly PlacedMessage[] => {
    const place = placeOf(projection, message);
    return place === undefined ? [] : [{ message, place }];
  });
}

function placedOf({ dialect, projection }: ProjectionKeeping, messages: readonly StoredMessage[]) {
  return placedIn(
    projection,
    messages.map((message) => ({ ...message, data: dialect.appendedData(message.data) })),
  );
}

export async function keptInTurn(
  keeping: ProjectionKeeping,
  execute: StatementExecutor,
  placed: readonly PlacedMessage[],
): Promise<void> {
  await rowsLocked(
    execute,
    keeping.dialect,
    keeping.projection,
    placed.map(({ place }) => place),
  );
  await inTurn(placed, ({ message, place }: PlacedMessage) => keptAfter(keeping, execute, place, message));
}

function keepingProjection(keeping: ProjectionKeeping): InlineProjection {
  return {
    types: keeping.projection.types,
    handle: (messages, execute) => keptInTurn(keeping, execute, placedOf(keeping, messages)),
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

export const noRows: ProjectedRows = new Map();

export function childRowsFoldedOver(
  { rowsAfter }: ChildRowsProjection,
  messages: readonly ProjectedMessage[],
  from: ProjectedRows,
): ProjectedRows {
  let rows = from;
  for (const message of messages) {
    rows = rowsAfter(rows, message) ?? rows;
  }
  return rows;
}

export function replayedRow(
  keeping: KeepingOf<KeyedProjection>,
  messages: readonly ReplayedMessage[],
  from?: ProjectedRow,
): ProjectedRow | undefined {
  return rowFoldedOver(
    keeping.projection,
    messages.map((message) => filledMessageOf(keeping, message)),
    from,
  );
}

export function replayedChildRows(
  keeping: KeepingOf<ChildRowsProjection>,
  messages: readonly ReplayedMessage[],
): ProjectedRows {
  return childRowsFoldedOver(
    keeping.projection,
    messages.map((message) => filledMessageOf(keeping, message)),
    noRows,
  );
}

export function projectionRegistrations(
  dialect: ProjectionDialect,
  projections: readonly KeptProjection[],
): readonly InlineRegistration[] {
  return projections.map((projection) => inlineRegistrationOf(keepingProjection({ dialect, projection })));
}
